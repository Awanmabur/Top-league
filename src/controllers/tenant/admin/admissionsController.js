const mongoose = require("mongoose");
const csv = require("csv-parser");
const { Readable } = require("stream");

const { makeApplicationId } = require("../../../utils/id");
const { uploadBuffer, safeDestroy } = require("../../../utils/cloudinaryUpload");
const { nextRegNo } = require("../../../utils/regNo");
const { sendMail } = require("../../../utils/mailer");
const { createSetPasswordInvite } = require("../../../utils/inviteService");
const { setupPasswordEmail } = require("../../../utils/emailTemplates");

const ALLOWED_STATUSES = ["submitted", "under_review", "accepted", "rejected", "converted"];
const MAX_IMPORT_ROWS = 2000;

const cleanEmail = (v) =>
  String(v || "")
    .trim()
    .toLowerCase();

const actorUserId = (req) =>
  req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;

const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));
const asDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const str = (v) => String(v ?? "").trim();

function escRegex(v) {
  return String(v || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeStatus(v, fallback = "submitted") {
  const s = str(v);
  return ALLOWED_STATUSES.includes(s) ? s : fallback;
}

function applicantBaseFilter({ q, section, program, status }) {
  const filter = { isDeleted: { $ne: true } };
  const and = [];

  if (q) {
    const rx = new RegExp(escRegex(q), "i");
    filter.$or = [
      { applicationId: rx },
      { firstName: rx },
      { lastName: rx },
      { fullName: rx },
      { email: rx },
      { phone: rx },
    ];
  }

  const sectionId = section || program;
  if (sectionId && isValidId(sectionId)) {
    and.push({ $or: [{ section1: sectionId }, { program1: sectionId }] });
  }
  if (status && ALLOWED_STATUSES.includes(status)) filter.status = status;
  if (and.length) filter.$and = and;

  return filter;
}

const pickFirst = (files, key) => files?.[key]?.[0] || null;
const pickMany = (files, key) => (Array.isArray(files?.[key]) ? files[key] : []);

function buildErrors(body, files) {
  const e = {};
  const req = (k, msg) => {
    if (!body?.[k] || !String(body[k]).trim()) e[k] = msg;
  };

  req("firstName", "First name is required");
  req("lastName", "Last name is required");
  req("gender", "Gender is required");
  req("dob", "Date of birth is required");
  req("nationality", "Nationality is required");
  req("address", "Address is required");
  req("phone", "Phone is required");
  req("email", "Email is required");

  req("academicYear", "Academic year is required");
  req("schoolLevel", "School level is required");
  req("classLevel", "Class level is required");
  req("term", "Term is required");
  req("intake", "Intake is required");

  const s1 = (body?.section1 || body?.sectionId || body?.program1 || body?.programId || "").toString().trim();
  if (!s1) e.section1 = "Section is required";

  req("qualification", "Highest qualification is required");
  req("school", "School/Institution is required");
  req("yearCompleted", "Year completed is required");

  req("guardianName", "Guardian name is required");
  req("guardianPhone", "Guardian phone is required");

  if (!body?.agree) e.agree = "You must agree before submitting";

  const dob = asDate(body?.dob);
  if (!dob) e.dob = "Provide a valid date of birth";

  const term = Number(body?.term);
  if (Number.isNaN(term) || term < 1 || term > 3) e.term = "Term must be 1-3";

  const yc = Number(body?.yearCompleted);
  if (Number.isNaN(yc) || yc < 1900 || yc > 2100) e.yearCompleted = "Year completed is invalid";

  if (!pickFirst(files, "passportPhoto")) e.passportPhoto = "Passport photo is required";
  if (!pickFirst(files, "idDocument")) e.idDocument = "ID document is required";
  if (!pickFirst(files, "transcript")) e.transcript = "Transcript/Results slip is required";

  return e;
}

function uniqRolesAdd(existingRoles, role) {
  const roles = new Set(Array.isArray(existingRoles) ? existingRoles : []);
  if (role) roles.add(role);
  return Array.from(roles);
}

function modelHasPath(Model, path) {
  try {
    return !!Model?.schema?.path(path);
  } catch (_) {
    return false;
  }
}

async function safeStudentSet(StudentModel, studentId, patch) {
  if (!StudentModel || !studentId || !patch) return;
  const $set = {};
  for (const [k, v] of Object.entries(patch)) {
    if (modelHasPath(StudentModel, k)) $set[k] = v;
  }
  if (!Object.keys($set).length) return;
  await StudentModel.updateOne({ _id: studentId }, { $set }).catch(() => {});
}

async function findOrCreateStudentUser({ req, StudentDoc, User }) {
  const email = cleanEmail(StudentDoc?.email);
  const fullName = str(StudentDoc?.fullName).slice(0, 120);
  const firstName = str(StudentDoc?.firstName).slice(0, 60) || fullName.split(" ")[0] || "Student";
  const lastName =
    str(StudentDoc?.lastName).slice(0, 60) ||
    fullName.split(" ").slice(1).join(" ") ||
    "Account";

  if (StudentDoc?.userId && isValidId(StudentDoc.userId)) {
    const u = await User.findOne({ _id: StudentDoc.userId, deletedAt: null }).select(
      "+passwordHash roles status tokenVersion email firstName lastName studentId",
    );
    if (u) return u;
  }

  let u = await User.findOne({ studentId: StudentDoc._id, deletedAt: null }).select(
    "+passwordHash roles status tokenVersion email firstName lastName studentId",
  );
  if (u) return u;

  if (email) {
    u = await User.findOne({ email, deletedAt: null }).select(
      "+passwordHash roles status tokenVersion email firstName lastName studentId",
    );
    if (u) return u;
  }

  if (!email) return null;

  const created = await User.create({
    firstName,
    lastName,
    email,
    phone: StudentDoc?.phone || null,
    roles: ["student"],
    status: "invited",
    passwordHash: null,
    tokenVersion: 0,
    studentId: StudentDoc._id,
    deletedAt: null,
    createdBy: actorUserId(req) || undefined,
  });

  await safeStudentSet(req.models?.Student, StudentDoc._id, { userId: created._id });
  return created;
}

async function findOrCreateParentUser({ req, StudentDoc, User }) {
  const guardianEmail = cleanEmail(StudentDoc?.guardianEmail);
  const guardianName = str(StudentDoc?.guardianName).slice(0, 120) || "Parent Account";

  const firstName = guardianName.split(" ")[0] || "Parent";
  const lastName = guardianName.split(" ").slice(1).join(" ") || "Account";

  if (StudentDoc?.guardianUserId && isValidId(StudentDoc.guardianUserId)) {
    const u = await User.findOne({ _id: StudentDoc.guardianUserId, deletedAt: null }).select(
      "+passwordHash roles status tokenVersion email firstName lastName childrenStudentIds",
    );
    if (u) return u;
  }

  if (guardianEmail) {
    const u = await User.findOne({ email: guardianEmail, deletedAt: null }).select(
      "+passwordHash roles status tokenVersion email firstName lastName childrenStudentIds",
    );
    if (u) return u;
  }

  if (!guardianEmail) return null;

  const created = await User.create({
    firstName,
    lastName,
    email: guardianEmail,
    phone: StudentDoc?.guardianPhone || null,
    roles: ["parent"],
    status: "invited",
    passwordHash: null,
    tokenVersion: 0,
    childrenStudentIds: [StudentDoc._id],
    deletedAt: null,
    createdBy: actorUserId(req) || undefined,
  });

  await safeStudentSet(req.models?.Student, StudentDoc._id, { guardianUserId: created._id });
  return created;
}

async function ensureParentRecord({ req, parentUser, studentId, StudentDoc }) {
  const { Parent } = req.models || {};
  if (!Parent || !parentUser?._id) return;

  const email = cleanEmail(parentUser.email);
  if (!email) return;

  const guardianName = str(StudentDoc?.guardianName).slice(0, 120) || "";
  const parts = guardianName.split(" ").filter(Boolean);
  const firstName = parts[0] || parentUser.firstName || "Parent";
  const lastName = parts.slice(1).join(" ") || parentUser.lastName || "";

  let p = await Parent.findOne({ userId: parentUser._id }).catch(() => null);
  if (!p) p = await Parent.findOne({ email }).catch(() => null);

  if (!p) {
    await Parent.create({
      userId: parentUser._id,
      firstName,
      lastName,
      email,
      phone: parentUser.phone || StudentDoc?.guardianPhone || "",
      childrenStudentIds: [studentId],
      relationship: "Guardian",
      status: "pending",
    }).catch(() => {});
    return;
  }

  const kids = new Set((p.childrenStudentIds || []).map(String));
  kids.add(String(studentId));

  const patch = {
    userId: p.userId || parentUser._id,
    firstName: p.firstName || firstName,
    lastName: p.lastName || lastName,
    phone: p.phone || parentUser.phone || StudentDoc?.guardianPhone || "",
    childrenStudentIds: Array.from(kids),
  };

  await Parent.updateOne({ _id: p._id }, { $set: patch }).catch(() => {});
}

async function sendSetupInvitesToStudentAndParent({ req, studentUser, parentUser }) {
  const { InviteToken } = req.models || {};
  if (!InviteToken) throw new Error("InviteToken model missing");

  const appName = process.env.APP_NAME || "Classic Academy";
  const createdBy = actorUserId(req);

  const stInvite = await createSetPasswordInvite({
    req,
    InviteToken,
    userId: studentUser._id,
    createdBy,
  });

  await sendMail({
    to: studentUser.email,
    subject: `${appName}: Set your password`,
    html: setupPasswordEmail({
      appName,
      firstName: studentUser.firstName,
      inviteLink: stInvite.inviteLink,
    }),
  });

  const paInvite = await createSetPasswordInvite({
    req,
    InviteToken,
    userId: parentUser._id,
    createdBy,
  });

  await sendMail({
    to: parentUser.email,
    subject: `${appName}: Set your password (Parent account)`,
    html: setupPasswordEmail({
      appName,
      firstName: parentUser.firstName,
      inviteLink: paInvite.inviteLink,
    }),
  });

  return { stInvite, paInvite };
}

async function provisionAccountsForStudent({ req, studentDoc }) {
  const { User } = req.models || {};
  if (!User) throw new Error("User model missing");

  const studentUser = await findOrCreateStudentUser({ req, StudentDoc: studentDoc, User });
  if (!studentUser) throw new Error("Student email missing (cannot create user/invite).");

  const parentUser = await findOrCreateParentUser({ req, StudentDoc: studentDoc, User });

  const stHasPw = !!studentUser.passwordHash;
  await User.updateOne(
    { _id: studentUser._id, deletedAt: null },
    {
      $set: {
        roles: uniqRolesAdd(studentUser.roles, "student"),
        status: stHasPw ? studentUser.status : "invited",
        studentId: studentUser.studentId || studentDoc._id,
      },
    },
  );

  if (!parentUser) {
    return { studentUser, parentUser: null, invitesSent: false, parentMissing: true };
  }

  const paHasPw = !!parentUser.passwordHash;
  const kids = new Set((parentUser.childrenStudentIds || []).map(String));
  kids.add(String(studentDoc._id));

  await User.updateOne(
    { _id: parentUser._id, deletedAt: null },
    {
      $set: {
        roles: uniqRolesAdd(parentUser.roles, "parent"),
        status: paHasPw ? parentUser.status : "invited",
        childrenStudentIds: Array.from(kids),
      },
    },
  );

  await ensureParentRecord({ req, parentUser, studentId: studentDoc._id, StudentDoc: studentDoc });

  let invitesSent = false;
  try {
    if (!studentUser.email) throw new Error("Student email missing (invite)");
    if (!parentUser.email) throw new Error("Parent email missing (invite)");
    await sendSetupInvitesToStudentAndParent({ req, studentUser, parentUser });
    invitesSent = true;
  } catch (_) {}

  return { studentUser, parentUser, invitesSent, parentMissing: false };
}

async function getApplicantListing(req) {
  const { Applicant, Section } = req.models;

  const q = str(req.query.q);
  const section = str(req.query.section || req.query.program);
  const status = str(req.query.status);

  const page = Math.max(parseInt(req.query.page || "1", 10), 1);
  const perPage = 20;

  const filter = applicantBaseFilter({ q, section, status });
  const total = await Applicant.countDocuments(filter);
  const totalPages = Math.max(Math.ceil(total / perPage), 1);
  const safePage = Math.min(page, totalPages);

  const applicants = await Applicant.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .skip((safePage - 1) * perPage)
    .limit(perPage)
    .populate("section1", "code name levelType classLevel classStream className")
    .populate("section2", "code name levelType classLevel classStream className")
    .populate("program1", "code name levelType classLevel classStream className")
    .populate("program2", "code name levelType classLevel classStream className")
    .lean();

  const sections = Section
    ? await Section.find({ status: { $ne: "archived" } })
    .select("code name levelType classLevel classStream className campusName")
    .sort({ levelType: 1, classLevel: 1, classStream: 1, name: 1 })
    .lean()
    : [];

  const pendingFilter = { ...filter, status: { $in: ["submitted", "under_review"] } };
  const acceptedFilter = { ...filter, status: { $in: ["accepted", "converted"] } };
  const rejectedFilter = { ...filter, status: "rejected" };

  const [pending, accepted, rejected] = await Promise.all([
    Applicant.countDocuments(pendingFilter),
    Applicant.countDocuments(acceptedFilter),
    Applicant.countDocuments(rejectedFilter),
  ]);

  return {
    applicants,
    programs: sections,
    sections,
    kpis: { total, pending, accepted, rejected },
    query: { q, section, program: section, status, page: safePage, total, totalPages, perPage },
  };
}

module.exports = {
  dashboard: async (req, res) => {
    return module.exports.listApplicants(req, res);
  },

  listApplicants: async (req, res) => {
    try {
      const listing = await getApplicantListing(req);

      return res.render("tenant/admin/admissions/applicants", {
        tenant: req.tenant || null,
        applicants: listing.applicants,
        programs: listing.programs,
        sections: listing.sections,
        csrfToken: req.csrfToken?.() || res.locals.csrfToken || null,
        kpis: listing.kpis,
        query: listing.query,
        messages: {
          success: req.flash ? req.flash("success") : [],
          error: req.flash ? req.flash("error") : [],
        },
      });
    } catch (err) {
      console.error("LIST APPLICANTS ERROR:", err);
      return res.status(500).send("Failed to load applicants.");
    }
  },

  exportApplicantsCsv: async (req, res) => {
    try {
      const { Applicant } = req.models;

      const q = str(req.query.q);
      const section = str(req.query.section || req.query.program);
      const status = str(req.query.status);

      const filter = applicantBaseFilter({ q, section, status });

      const rows = await Applicant.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .populate("section1", "code name classLevel classStream")
        .populate("program1", "code name classLevel classStream")
        .lean();

      const csvRows = [
        ["ApplicationId", "FullName", "Email", "Phone", "SectionCode", "SectionName", "Intake", "Status", "SubmittedAt"],
        ...rows.map((a) => {
          const sec = a.section1 || a.program1 || null;
          return [
          a.applicationId || "",
          (a.fullName || [a.firstName, a.middleName, a.lastName].filter(Boolean).join(" ")).trim(),
          a.email || "",
          a.phone || "",
          sec?.code || "",
          sec?.name || sec?.className || "",
          a.intake || "",
          a.status || "",
          a.createdAt ? new Date(a.createdAt).toISOString() : "",
          ];
        }),
      ];

      const esc = (value) => {
        const s = String(value ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };

      const csvText = csvRows.map((row) => row.map(esc).join(",")).join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="applicants-export.csv"');
      return res.send(csvText);
    } catch (err) {
      console.error("EXPORT APPLICANTS CSV ERROR:", err);
      req.flash?.("error", "Failed to export applicants.");
      return res.redirect("/admin/admissions/applicants");
    }
  },

  importApplicantsCsv: async (req, res) => {
    try {
      const { Applicant, Section } = req.models;
      const file = req.file;

      if (!file || !file.buffer) {
        req.flash?.("error", "Please choose a CSV file.");
        return res.redirect("/admin/admissions/applicants");
      }

      const rows = [];
      const stream = Readable.from(file.buffer.toString("utf8"));

      await new Promise((resolve, reject) => {
        stream
          .pipe(csv())
          .on("data", (row) => {
            if (rows.length < MAX_IMPORT_ROWS) rows.push(row);
          })
          .on("end", resolve)
          .on("error", reject);
      });

      if (!rows.length) {
        req.flash?.("error", "The CSV file is empty.");
        return res.redirect("/admin/admissions/applicants");
      }

      const inserted = [];
      let skipped = 0;

      for (const raw of rows) {
        const firstName = str(raw.firstName);
        const lastName = str(raw.lastName);
        const email = cleanEmail(raw.email);
        const phone = str(raw.phone);
        const intake = str(raw.intake) || "aug";
        const status = safeStatus(raw.status, "submitted");
        const sectionCode = str(raw.sectionCode || raw.programCode).toUpperCase();

        if (!firstName || !lastName || !email || !sectionCode) {
          skipped += 1;
          continue;
        }

        const section = await Section.findOne({ code: sectionCode, status: { $ne: "archived" } })
          .select("_id levelType classLevel")
          .lean();

        if (!section) {
          skipped += 1;
          continue;
        }

        const exists = await Applicant.findOne({
          email,
          $or: [{ section1: section._id }, { program1: section._id }],
          isDeleted: { $ne: true },
        }).select("_id").lean();

        if (exists) {
          skipped += 1;
          continue;
        }

        let applicationId = makeApplicationId();
        for (let i = 0; i < 5; i++) {
          const found = await Applicant.findOne({ applicationId, isDeleted: { $ne: true } }).lean();
          if (!found) break;
          applicationId = makeApplicationId();
        }

        inserted.push({
          applicationId,
          firstName,
          lastName,
          fullName: `${firstName} ${lastName}`.trim(),
          email,
          phone,
          intake,
          status,
          section1: section._id,
          program1: section._id,
          academicYear: raw.academicYear || "",
          schoolLevel: raw.schoolLevel || section.levelType || "",
          classLevel: raw.classLevel || section.classLevel || "",
          term: Number(raw.term || 1),
          yearLevel: raw.classLevel || section.classLevel || "",
          semester: Number(raw.term || 1),
          studyMode: raw.studyMode || "day",
          qualification: raw.qualification || "Imported",
          school: raw.school || "Imported",
          yearCompleted: Number(raw.yearCompleted || new Date().getFullYear()),
          guardianName: raw.guardianName || "Imported Guardian",
          guardianPhone: raw.guardianPhone || phone || "N/A",
          address: raw.address || "Imported",
          gender: raw.gender || "Not specified",
          dob: raw.dob ? new Date(raw.dob) : new Date("2000-01-01"),
          nationality: raw.nationality || "Not specified",
          notes: raw.notes || "Imported from CSV",
        });
      }

      if (inserted.length) {
        await Applicant.insertMany(inserted, { ordered: false });
      }

      req.flash?.("success", `Import completed. Added ${inserted.length} applicant(s).`);
      if (skipped) {
        req.flash?.("error", `${skipped} row(s) were skipped due to missing fields, duplicates, or invalid section code.`);
      }
      return res.redirect("/admin/admissions/applicants");
    } catch (err) {
      console.error("IMPORT APPLICANTS CSV ERROR:", err);
      req.flash?.("error", "Failed to import applicants CSV.");
      return res.redirect("/admin/admissions/applicants");
    }
  },

  viewApplicant: async (req, res) => {
    const { Applicant, Class, Section } = req.models;

    if (!isValidId(req.params.id)) return res.status(404).send("Invalid applicant ID");

    const applicant = await Applicant.findOne({
      _id: req.params.id,
      isDeleted: { $ne: true },
    })
      .populate("preferredClassGroup", "code name title")
      .populate("section1", "code name levelType classLevel classStream className classId classCode campusName schoolUnitName")
      .populate("section2", "code name levelType classLevel classStream className classId classCode campusName schoolUnitName")
      .populate("program1", "code name levelType classLevel classStream className classId classCode campusName schoolUnitName")
      .populate("program2", "code name levelType classLevel classStream className classId classCode campusName schoolUnitName")
      .lean();

    if (!applicant) return res.status(404).send("Applicant not found");

    const classes = await Class.find({ isDeleted: { $ne: true } })
      .sort({ name: 1 })
      .lean();
    const sections = Section
      ? await Section.find({ status: { $ne: "archived" } })
          .sort({ levelType: 1, classLevel: 1, classStream: 1, name: 1 })
          .lean()
      : [];

    return res.render("tenant/admin/admissions/applicant-view", {
      tenant: req.tenant,
      applicant,
      classes,
      sections,
      csrfToken: req.csrfToken?.(),
      err: String(req.query.err || ""),
    });
  },

  applyForm: async (req, res) => {
    const { Section } = req.models;

    const sections = await Section.find({ status: { $ne: "archived" } })
      .sort({ levelType: 1, classLevel: 1, classStream: 1, name: 1 })
      .lean();

    return res.render("tenant/public/admissions/apply", {
      tenant: req.tenant,
      sections,
      csrfToken: req.csrfToken?.(),
      errors: null,
      formData: null,
      applicationId: null,
    });
  },

  submitApplication: async (req, res) => {
    const { Applicant, Section } = req.models;

    const sections = await Section.find({ status: { $ne: "archived" } })
      .sort({ levelType: 1, classLevel: 1, classStream: 1, name: 1 })
      .lean();

    const errors = buildErrors(req.body, req.files);
    if (Object.keys(errors).length) {
      return res.status(422).render("tenant/public/admissions/apply", {
        tenant: req.tenant,
        sections,
        csrfToken: req.csrfToken?.(),
        errors,
        formData: req.body,
        applicationId: null,
      });
    }

    const folderBase = process.env.CLOUDINARY_FOLDER || "classic-academy";
    const folder = `${folderBase}/${req.tenant?.code || req.tenant?._id || "tenant"}/admissions`;

    const uploaded = [];

    const mkDoc = (file, up) => ({
      url: up.secure_url,
      publicId: up.public_id,
      resourceType: up.resource_type || "auto",
      originalName: file.originalname,
      bytes: file.size || up.bytes || 0,
      mimeType: file.mimetype,
    });

    try {
      const passportFile = pickFirst(req.files, "passportPhoto");
      const idFile = pickFirst(req.files, "idDocument");
      const transcriptFile = pickFirst(req.files, "transcript");
      const otherFiles = pickMany(req.files, "otherDocs");

      const upPassport = await uploadBuffer(passportFile, folder, { resource_type: "image" });
      uploaded.push({ publicId: upPassport.public_id, resourceType: upPassport.resource_type });

      const upId = await uploadBuffer(idFile, folder, { resource_type: "auto" });
      uploaded.push({ publicId: upId.public_id, resourceType: upId.resource_type });

      const upTranscript = await uploadBuffer(transcriptFile, folder, { resource_type: "auto" });
      uploaded.push({ publicId: upTranscript.public_id, resourceType: upTranscript.resource_type });

      const otherDocs = [];
      for (const f of otherFiles) {
        const up = await uploadBuffer(f, folder, { resource_type: "auto" });
        uploaded.push({ publicId: up.public_id, resourceType: up.resource_type });
        otherDocs.push(mkDoc(f, up));
      }

      let applicationId = makeApplicationId();
      for (let i = 0; i < 5; i++) {
        const exists = await Applicant.findOne({ applicationId, isDeleted: { $ne: true } }).lean();
        if (!exists) break;
        applicationId = makeApplicationId();
      }

      const section1 = str(req.body.section1 || req.body.sectionId || req.body.program1 || req.body.programId);
      const section2 = str(req.body.section2 || req.body.section2Id || req.body.program2 || req.body.program2Id);

      const applicant = await Applicant.create({
        applicationId,
        firstName: req.body.firstName,
        middleName: req.body.middleName,
        lastName: req.body.lastName,
        gender: req.body.gender,
        dob: asDate(req.body.dob),
        nationality: req.body.nationality,
        address: req.body.address,
        email: req.body.email,
        phone: req.body.phone,
        guardianName: req.body.guardianName,
        guardianPhone: req.body.guardianPhone,
        guardianEmail: req.body.guardianEmail,
        academicYear: req.body.academicYear,
        schoolLevel: req.body.schoolLevel,
        classLevel: req.body.classLevel,
        term: Number(req.body.term || 1),
        semester: Number(req.body.term || req.body.semester || 1),
        yearLevel: req.body.classLevel || req.body.yearLevel,
        intake: req.body.intake,
        studyMode: req.body.studyMode || "day",
        section1,
        section2: section2 || null,
        program1: section1,
        program2: section2 || null,
        preferredClassGroup: req.body.preferredClassGroup || null,
        qualification: req.body.qualification,
        school: req.body.school,
        yearCompleted: Number(req.body.yearCompleted),
        grades: req.body.grades || "",
        notes: req.body.notes || "",
        passportPhoto: mkDoc(passportFile, upPassport),
        idDocument: mkDoc(idFile, upId),
        transcript: mkDoc(transcriptFile, upTranscript),
        otherDocs,
      });

      return res.render("tenant/public/admissions/apply", {
        tenant: req.tenant,
        sections,
        csrfToken: req.csrfToken?.(),
        errors: null,
        formData: null,
        applicationId: applicant.applicationId,
      });
    } catch (err) {
      for (const u of uploaded) {
        await safeDestroy(u.publicId, u.resourceType || "auto");
      }

      return res.status(500).render("tenant/public/admissions/apply", {
        tenant: req.tenant,
        sections,
        csrfToken: req.csrfToken?.(),
        errors: { general: err.message || "Failed to submit application" },
        formData: req.body,
        applicationId: null,
      });
    }
  },

  updateStatus: async (req, res) => {
    const { Applicant } = req.models;

    if (!isValidId(req.params.id)) return res.status(404).send("Invalid applicant ID");

    const status = str(req.body.status);
    const notes = str(req.body.notes);

    await Applicant.findOneAndUpdate(
      { _id: req.params.id, isDeleted: { $ne: true } },
      {
        status,
        adminNotes: notes,
        decidedAt: ["accepted", "rejected", "converted"].includes(status) ? new Date() : null,
        decidedBy: ["accepted", "rejected", "converted"].includes(status)
          ? req.user?._id || null
          : null,
      },
    );

    return res.redirect(`/admin/admissions/applicants/${req.params.id}`);
  },

  acceptApplicant: async (req, res) => {
    const { Applicant, Student, Section } = req.models;

    if (!isValidId(req.params.id)) return res.status(404).send("Invalid applicant ID");

    const applicant = await Applicant.findOne({
      _id: req.params.id,
      isDeleted: { $ne: true },
    });
    if (!applicant) return res.status(404).send("Applicant not found");

    if (applicant.status === "converted" && applicant.convertedStudentId) {
      return res.redirect(`/admin/students?regNo=${encodeURIComponent(applicant.regNo || "")}`);
    }

    const sectionId = str(req.body.section || req.body.sectionId || req.body.classGroup || applicant.section1 || applicant.program1 || "");
    if (!sectionId) {
      return res.redirect(`/admin/admissions/applicants/${req.params.id}?err=section_required`);
    }
    if (!mongoose.Types.ObjectId.isValid(sectionId)) {
      return res.redirect(`/admin/admissions/applicants/${req.params.id}?err=section_invalid`);
    }

    const section = Section
      ? await Section.findById(sectionId).select("code name levelType classLevel classStream classId className classCode schoolUnitId schoolUnitName schoolUnitCode campusId campusName campusCode").lean()
      : null;

    if (!section) {
      return res.redirect(`/admin/admissions/applicants/${req.params.id}?err=section_invalid`);
    }

    if (modelHasPath(Student, "applicationId")) {
      const existing = await Student.findOne({ applicationId: applicant._id, isDeleted: { $ne: true } }).lean();
      if (existing) {
        applicant.status = "converted";
        applicant.convertedStudentId = existing._id;
        applicant.linkedStudent = existing._id;
        await applicant.save().catch(() => {});
        return res.redirect(`/admin/students?regNo=${encodeURIComponent(existing.regNo || "")}`);
      }
    }

    const regNo = await nextRegNo(req.models);

    const builtFullName =
      str(applicant.fullName) ||
      [applicant.firstName, applicant.middleName, applicant.lastName]
        .map((x) => str(x))
        .filter(Boolean)
        .join(" ")
        .trim();

    let student = null;

    try {
      const studentPayload = {
        fullName: builtFullName,
        firstName: applicant.firstName,
        middleName: applicant.middleName,
        lastName: applicant.lastName,
        regNo,
        studentNo: regNo,
        email: applicant.email,
        phone: applicant.phone,
        schoolUnitId: section.schoolUnitId || "",
        schoolUnitName: section.schoolUnitName || "",
        schoolUnitCode: section.schoolUnitCode || "",
        campusId: section.campusId || "",
        campusName: section.campusName || "",
        campusCode: section.campusCode || "",
        classId: section.classId ? String(section.classId) : "",
        className: section.className || "",
        classCode: section.classCode || "",
        section: section.classStream || section.name || "",
        stream: section.classStream || section.name || "",
        schoolLevel: applicant.schoolLevel || section.levelType || "primary",
        classLevel: applicant.classLevel || section.classLevel || "P1",
        academicYear: applicant.academicYear,
        term: applicant.term || applicant.semester || 1,
        status: "active",
        gender: applicant.gender,
        dob: applicant.dob,
        nationality: applicant.nationality,
        address: applicant.address,
        guardianName: applicant.guardianName,
        guardianPhone: applicant.guardianPhone,
        guardianEmail: applicant.guardianEmail,
        photoUrl: applicant.passportPhoto?.url || "",
        createdBy: req.user?._id || null,
        updatedBy: req.user?._id || null,
      };

      if (modelHasPath(Student, "applicationId")) studentPayload.applicationId = applicant._id;

      student = await Student.create(studentPayload);

      applicant.status = "converted";
      applicant.decidedAt = new Date();
      applicant.decidedBy = req.user?._id || null;
      applicant.decisionNote = str(req.body.decisionNote || applicant.decisionNote || "");
      applicant.section1 = section._id;
      applicant.program1 = section._id;
      applicant.convertedStudentId = student._id;
      applicant.linkedStudent = student._id;
      applicant.regNo = regNo;
      await applicant.save();

      const result = await provisionAccountsForStudent({ req, studentDoc: student });

      if (result.parentMissing) {
        req.flash?.("success", `Applicant accepted. Student created (${regNo}).`);
        req.flash?.("error", "Parent account NOT created: guardian email missing.");
      } else if (result.invitesSent) {
        req.flash?.(
          "success",
          `Applicant accepted. Student created (${regNo}). Setup links emailed to student + parent.`,
        );
      } else {
        req.flash?.("success", `Applicant accepted. Student created (${regNo}).`);
        req.flash?.(
          "error",
          "Student/Parent accounts created, but setup emails were not sent (SMTP/InviteToken issue).",
        );
      }

      return res.redirect(`/admin/students?regNo=${encodeURIComponent(regNo)}`);
    } catch (err) {
      console.error("ACCEPT APPLICANT ERROR:", err);

      if (student?._id) {
        req.flash?.("success", `Applicant accepted. Student created (${regNo}).`);
        req.flash?.("error", `But provisioning failed: ${err.message}`);
        return res.redirect(`/admin/students?regNo=${encodeURIComponent(regNo)}`);
      }

      req.flash?.("error", err.message || "Failed to accept applicant.");
      return res.redirect(`/admin/admissions/applicants/${req.params.id}?err=accept_failed`);
    }
  },

  rejectApplicant: async (req, res) => {
    const { Applicant } = req.models;

    if (!isValidId(req.params.id)) return res.status(404).send("Invalid applicant ID");

    const reason = str(req.body.reason || req.body.notes || req.body.decisionNote || "");

    await Applicant.findOneAndUpdate(
      { _id: req.params.id, isDeleted: { $ne: true } },
      {
        status: "rejected",
        adminNotes: reason,
        decidedAt: new Date(),
        decidedBy: req.user?._id || null,
      },
    );

    return res.redirect("/admin/admissions/applicants");
  },

  bulkAction: async (req, res) => {
    try {
      const { Applicant } = req.models;

      const action = str(req.body.action);
      const message = str(req.body.message);

      const ids = str(req.body.ids)
        .split(",")
        .map((x) => x.trim())
        .filter((x) => isValidId(x));

      if (!ids.length) {
        req.flash?.("error", "No applicants selected.");
        return res.redirect("/admin/admissions/applicants");
      }

      const patch = {};
      if (action === "set_under_review") {
        patch.status = "under_review";
        patch.decidedAt = null;
        patch.decidedBy = null;
      } else if (action === "accept") {
        patch.status = "accepted";
        patch.decidedAt = new Date();
        patch.decidedBy = req.user?._id || null;
      } else if (action === "reject") {
        patch.status = "rejected";
        patch.decidedAt = new Date();
        patch.decidedBy = req.user?._id || null;
      } else {
        req.flash?.("error", "Invalid bulk action.");
        return res.redirect("/admin/admissions/applicants");
      }

      if (message) patch.adminNotes = message.slice(0, 1200);

      await Applicant.updateMany(
        { _id: { $in: ids }, isDeleted: { $ne: true } },
        { $set: patch },
      );

      req.flash?.("success", "Bulk action applied.");
      return res.redirect("/admin/admissions/applicants");
    } catch (err) {
      console.error("BULK APPLICANTS ACTION ERROR:", err);
      req.flash?.("error", "Bulk action failed.");
      return res.redirect("/admin/admissions/applicants");
    }
  },

  exportApplicant: async (req, res) => {
    try {
      const { Applicant } = req.models;
      if (!isValidId(req.params.id)) return res.status(404).send("Invalid applicant ID");

      const a = await Applicant.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
        .populate("section1", "code name classLevel classStream")
        .populate("program1", "code name classLevel classStream")
        .lean();

      if (!a) return res.status(404).send("Applicant not found");

      const sec = a.section1 || a.program1 || {};
      const rows = [
        ["Field", "Value"],
        ["Application ID", a.applicationId || ""],
        ["Name", (a.fullName || [a.firstName, a.middleName, a.lastName].filter(Boolean).join(" ")).trim()],
        ["Email", a.email || ""],
        ["Phone", a.phone || ""],
        ["Section", `${sec.code ? `${sec.code} - ` : ""}${sec.name || sec.className || ""}`],
        ["Academic Year", a.academicYear || ""],
        ["Term", a.term || ""],
        ["Status", a.status || ""],
      ];

      const esc = (value) => {
        const s = String(value ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${a.applicationId || "applicant"}.csv"`);
      return res.send(rows.map((row) => row.map(esc).join(",")).join("\n"));
    } catch (err) {
      console.error("EXPORT APPLICANT ERROR:", err);
      req.flash?.("error", "Failed to export applicant.");
      return res.redirect(`/admin/admissions/applicants/${req.params.id}`);
    }
  },

  updateStatus: async (req, res) => {
    try {
      const { Applicant } = req.models;
      if (!isValidId(req.params.id)) return res.status(404).send("Invalid applicant ID");

      const status = safeStatus(req.body.status, "under_review");
      const patch = {
        status,
        decisionNote: str(req.body.decisionNote || req.body.notes || ""),
      };
      if (["accepted", "rejected", "converted"].includes(status)) {
        patch.decidedAt = new Date();
        patch.decidedBy = req.user?._id || null;
      }

      await Applicant.updateOne({ _id: req.params.id, isDeleted: { $ne: true } }, { $set: patch });
      req.flash?.("success", "Applicant status updated.");
      return res.redirect(`/admin/admissions/applicants/${req.params.id}`);
    } catch (err) {
      console.error("UPDATE APPLICANT STATUS ERROR:", err);
      req.flash?.("error", "Failed to update status.");
      return res.redirect(`/admin/admissions/applicants/${req.params.id}`);
    }
  },

  shortlistApplicant: async (req, res) => {
    try {
      const { Applicant } = req.models;
      if (!isValidId(req.params.id)) return res.status(404).send("Invalid applicant ID");

      await Applicant.updateOne(
        { _id: req.params.id, isDeleted: { $ne: true } },
        { $set: { status: "under_review", adminNotes: "Shortlisted for review" } },
      );
      req.flash?.("success", "Applicant shortlisted for review.");
      return res.redirect(`/admin/admissions/applicants/${req.params.id}`);
    } catch (err) {
      console.error("SHORTLIST APPLICANT ERROR:", err);
      req.flash?.("error", "Failed to shortlist applicant.");
      return res.redirect(`/admin/admissions/applicants/${req.params.id}`);
    }
  },

  saveNotes: async (req, res) => {
    try {
      const { Applicant } = req.models;
      if (!isValidId(req.params.id)) return res.status(404).send("Invalid applicant ID");

      const tags = str(req.body.tags)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 20);

      await Applicant.updateOne(
        { _id: req.params.id, isDeleted: { $ne: true } },
        { $set: { adminNotes: str(req.body.adminNotes).slice(0, 1200), tags } },
      );
      req.flash?.("success", "Applicant notes saved.");
      return res.redirect(`/admin/admissions/applicants/${req.params.id}`);
    } catch (err) {
      console.error("SAVE APPLICANT NOTES ERROR:", err);
      req.flash?.("error", "Failed to save notes.");
      return res.redirect(`/admin/admissions/applicants/${req.params.id}`);
    }
  },

  requestDocs: async (req, res) => {
    try {
      const { Applicant } = req.models;
      if (!isValidId(req.params.id)) return res.status(404).send("Invalid applicant ID");

      const applicant = await Applicant.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
      if (!applicant) return res.status(404).send("Applicant not found");

      const missingKeys = str(req.body.missingKeys)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      applicant.requestedDocs = applicant.requestedDocs || [];
      applicant.requestedDocs.push({
        missingKeys,
        via: str(req.body.via) || "email",
        deadline: asDate(req.body.deadline),
        message: str(req.body.message).slice(0, 1200),
        requestedAt: new Date(),
        requestedBy: req.user?._id || null,
      });
      applicant.adminNotes = [applicant.adminNotes, "Missing documents requested"].filter(Boolean).join("\n").slice(0, 1200);
      await applicant.save();

      req.flash?.("success", "Document request recorded.");
      return res.redirect(`/admin/admissions/applicants/${req.params.id}`);
    } catch (err) {
      console.error("REQUEST DOCS ERROR:", err);
      req.flash?.("error", "Failed to request documents.");
      return res.redirect(`/admin/admissions/applicants/${req.params.id}`);
    }
  },

  scheduleInterview: async (req, res) => {
    try {
      const { Applicant } = req.models;
      if (!isValidId(req.params.id)) return res.status(404).send("Invalid applicant ID");

      const when = asDate(`${str(req.body.date)}T${str(req.body.time) || "00:00"}`);
      await Applicant.updateOne(
        { _id: req.params.id, isDeleted: { $ne: true } },
        {
          $set: {
            status: "under_review",
            interviewStatus: "Scheduled",
            interviewWhen: when,
            interviewMode: str(req.body.mode) || "in-person",
            interviewPanel: str(req.body.panel),
            adminNotes: str(req.body.notes).slice(0, 1200),
          },
        },
      );

      req.flash?.("success", "Interview scheduled.");
      return res.redirect(`/admin/admissions/applicants/${req.params.id}`);
    } catch (err) {
      console.error("SCHEDULE INTERVIEW ERROR:", err);
      req.flash?.("error", "Failed to schedule interview.");
      return res.redirect(`/admin/admissions/applicants/${req.params.id}`);
    }
  },
};
