const mongoose = require("mongoose");
const csv = require("csv-parser");
const { Readable } = require("stream");

const { uploadBuffer, safeDestroy } = require("../../../utils/cloudinaryUpload");
const { nextRegNo } = require("../../../utils/regNo");
const { sendMail } = require("../../../utils/mailer");
const { createSetPasswordInvite } = require("../../../utils/inviteService");
const { setupPasswordEmail } = require("../../../utils/emailTemplates");
const { syncApplicantDocsToStudentDocs } = require("../../../utils/studentDocs");
const {
  allocateApplicationId,
  assertApplicantTransition,
  claimApplicantConversion,
  csvCell,
  documentCompleteness,
  finalizeApplicantConversion,
  interviewEmail,
  normalizeChecklist,
  normalizeInterviewMode,
  normalizeRequestChannel,
  normalizeRequestedDocKeys,
  releaseApplicantConversion,
  requestDocsEmail,
  sanitizeTags,
} = require("../../../services/tenant/admissionsService");
const {
  ensureSingleRoleForUser,
  singleRoleUpdate,
} = require("../../../utils/tenantUserAccounts");

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

function admissionsBackUrl(req, fallback) {
  const ref = str(req.get?.("referer"));
  if (!ref) return fallback;

  try {
    const url = new URL(ref, "http://localhost");
    const path = `${url.pathname || ""}${url.search || ""}`;
    return url.pathname.startsWith("/admin/admissions") ? path : fallback;
  } catch (_) {
    return fallback;
  }
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
  if (status === "received") filter.status = "submitted";
  else if (status === "interview") {
    filter.status = "under_review";
    filter.interviewStatus = "Scheduled";
  }
  else if (status && ALLOWED_STATUSES.includes(status)) filter.status = status;
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
    if (u) return ensureSingleRoleForUser(u, "student", email);
  }

  let u = await User.findOne({ studentId: StudentDoc._id, deletedAt: null }).select(
    "+passwordHash roles status tokenVersion email firstName lastName studentId",
  );
  if (u) return ensureSingleRoleForUser(u, "student", email);

  if (email) {
    u = await User.findOne({ email, deletedAt: null }).select(
      "+passwordHash roles status tokenVersion email firstName lastName studentId",
    );
    if (u) return ensureSingleRoleForUser(u, "student", email);
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
    if (u) return ensureSingleRoleForUser(u, "parent", guardianEmail);
  }

  if (guardianEmail) {
    const u = await User.findOne({ email: guardianEmail, deletedAt: null }).select(
      "+passwordHash roles status tokenVersion email firstName lastName childrenStudentIds",
    );
    if (u) return ensureSingleRoleForUser(u, "parent", guardianEmail);
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
        ...singleRoleUpdate("student"),
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
        ...singleRoleUpdate("parent"),
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
  const sectionsPromise = Section
    ? Section.find({ status: { $ne: "archived" } })
        .select("code name levelType classLevel classStream className campusName")
        .sort({ levelType: 1, classLevel: 1, classStream: 1, name: 1 })
        .lean()
    : Promise.resolve([]);
  const summaryPromise = Applicant.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        pending: { $sum: { $cond: [{ $in: ["$status", ["submitted", "under_review"]] }, 1, 0] } },
        accepted: { $sum: { $cond: [{ $in: ["$status", ["accepted", "converted"]] }, 1, 0] } },
        rejected: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
      },
    },
  ]);

  const summaryRows = await summaryPromise;
  const summary = summaryRows[0] || {};
  const total = Number(summary.total || 0);
  const totalPages = Math.max(Math.ceil(total / perPage), 1);
  const safePage = Math.min(page, totalPages);

  const [applicants, sections] = await Promise.all([
    Applicant.find(filter)
      .select(
        "applicationId fullName firstName middleName lastName email phone intake status interviewStatus interviewWhen createdAt section1 section2 program1 program2 passportPhoto idDocument transcript otherDocs adminNotes notes",
      )
      .sort({ createdAt: -1, _id: -1 })
      .skip((safePage - 1) * perPage)
      .limit(perPage)
      .populate("section1", "name levelType classLevel classStream className")
      .populate("section2", "code name levelType classLevel classStream className")
      .populate("program1", "name levelType classLevel classStream className")
      .populate("program2", "code name levelType classLevel classStream className")
      .lean(),
    sectionsPromise,
  ]);
  const pending = Number(summary.pending || 0);
  const accepted = Number(summary.accepted || 0);
  const rejected = Number(summary.rejected || 0);

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
    try {
      const listing = await getApplicantListing(req);

      return res.render("tenant/admissions/index", {
        tenant: req.tenant || null,
        applicants: listing.applicants,
        programs: listing.programs,
        sections: listing.sections,
        csrfToken: req.csrfToken?.() || res.locals.csrfToken || null,
        kpis: listing.kpis,
        query: listing.query,
        pagination: {
          page: listing.query.page,
          pages: listing.query.totalPages,
          total: listing.query.total,
          perPage: listing.query.perPage,
        },
        messages: {
          success: req.flash ? req.flash("success") : [],
          error: req.flash ? req.flash("error") : [],
        },
      });
    } catch (err) {
      console.error("ADMISSIONS DASHBOARD ERROR:", err);
      return res.status(500).send("Failed to load admissions.");
    }
  },

  listApplicants: async (req, res) => {
    try {
      const listing = await getApplicantListing(req);

      return res.render("tenant/admissions/applicants", {
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
        .populate("section1", "name classLevel classStream")
        .populate("program1", "name classLevel classStream")
        .lean();

      const csvRows = [
        ["ApplicationId", "FullName", "Email", "Phone", "SectionName", "Stream", "Term", "Status", "SubmittedAt"],
        ...rows.map((a) => {
          const sec = a.section1 || a.program1 || null;
          return [
          a.applicationId || "",
          (a.fullName || [a.firstName, a.middleName, a.lastName].filter(Boolean).join(" ")).trim(),
          a.email || "",
          a.phone || "",
          sec?.name || sec?.className || "",
          a.streamName || sec?.classStream || "",
          a.intake || "",
          a.status || "",
          a.createdAt ? new Date(a.createdAt).toISOString() : "",
          ];
        }),
      ];

      const csvText = csvRows.map((row) => row.map(csvCell).join(",")).join("\n");

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

        const applicationId = await allocateApplicationId(Applicant);

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
    const { Applicant, Class, Section, AuditLog, Intake, OfferLetter } = req.models;

    if (!isValidId(req.params.id)) return res.status(404).send("Invalid applicant ID");

    const applicant = await Applicant.findOne({
      _id: req.params.id,
      isDeleted: { $ne: true },
    })
      .populate("preferredClassGroup", "code name title")
      .populate("intakeId", "name term year")
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

    let auditEntries = [];
    if (AuditLog) {
      try {
        const auditOr = [{ entityId: applicant._id }];
        if (applicant.applicationId) {
          auditOr.push({ entityLabel: applicant.applicationId });
          auditOr.push({ "metadata.applicationId": applicant.applicationId });
        }
        if (applicant.regNo) auditOr.push({ "metadata.regNo": applicant.regNo });
        auditEntries = await AuditLog.find({
          isDeleted: { $ne: true },
          $or: auditOr,
        })
          .sort({ createdAt: -1 })
          .limit(20)
          .lean();
      } catch (_) {}
    }

    if (applicant.intakeId && typeof applicant.intakeId === "object") {
      applicant.termName = applicant.intakeId.term || applicant.intakeId.name || "";
      if (!applicant.academicYear && applicant.intakeId.year) applicant.academicYear = String(applicant.intakeId.year);
    } else if (applicant.intakeId && Intake) {
      try {
        const termDoc = await Intake.findById(applicant.intakeId).select("name term year").lean();
        if (termDoc) {
          applicant.termName = termDoc.term || termDoc.name || "";
          if (!applicant.academicYear && termDoc.year) applicant.academicYear = String(termDoc.year);
        }
      } catch (_) {}
    }

    applicant.auditEntries = auditEntries.map((x) => ({
      title: x.action || x.module || "Update",
      createdAt: x.createdAt,
      by: x.actorName || x.actorEmail || "System",
    }));

    applicant.documentStats = documentCompleteness(applicant);
    applicant.latestOfferLetter = OfferLetter
      ? await OfferLetter.findOne({ applicant: applicant._id, isDeleted: { $ne: true } })
          .sort({ createdAt: -1, _id: -1 })
          .select("letterNo status revision deliveryStatus issuedAt sentAt sentToEmail subject")
          .lean()
          .catch(() => null)
      : null;

    return res.render("tenant/admissions/applicant-view", {
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

      const applicationId = await allocateApplicationId(Applicant);

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

  acceptApplicant: async (req, res) => {
    const { Applicant, Student, Section, StudentDoc } = req.models;

    if (!isValidId(req.params.id)) return res.status(404).send("Invalid applicant ID");

    let applicant = await Applicant.findOne({
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

    let conversionClaim = null;
    let conversionFinalized = false;
    try {
      conversionClaim = await claimApplicantConversion(Applicant, {
        id: applicant._id,
        currentStatus: applicant.status,
        actorUserId: actorUserId(req),
        decisionNote: req.body.decisionNote || applicant.decisionNote || "",
      });
      applicant = conversionClaim.applicant;
    } catch (err) {
      req.flash?.("error", err.message || "Applicant could not be claimed for admission.");
      return res.redirect(`/admin/admissions/applicants/${req.params.id}`);
    }

    try {
      if (modelHasPath(Student, "applicationId")) {
        const existing = await Student.findOne({ applicationId: applicant._id, isDeleted: { $ne: true } }).lean();
        if (existing) {
          await finalizeApplicantConversion(Applicant, {
            id: applicant._id, token: conversionClaim.token, studentId: existing._id,
            regNo: existing.regNo || applicant.regNo || "", sectionId: section._id,
          });
          conversionFinalized = true;
          return res.redirect(`/admin/students?regNo=${encodeURIComponent(existing.regNo || "")}`);
        }
      }
    } catch (err) {
      await releaseApplicantConversion(Applicant, applicant._id, conversionClaim.token);
      req.flash?.("error", err.message || "Existing student could not be linked safely.");
      return res.redirect(`/admin/admissions/applicants/${req.params.id}`);
    }

    let regNo = "";

    const builtFullName =
      str(applicant.fullName) ||
      [applicant.firstName, applicant.middleName, applicant.lastName]
        .map((x) => str(x))
        .filter(Boolean)
        .join(" ")
        .trim();

    let student = null;

    try {
      regNo = await nextRegNo(req.models);
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
        intakeId: applicant.intakeId ? String(applicant.intakeId) : "",
        streamId: applicant.streamId ? String(applicant.streamId) : "",
        sectionId: section._id ? String(section._id) : "",
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
        qualification: applicant.qualification || "",
        school: applicant.school || "",
        yearCompleted: applicant.yearCompleted || null,
        grades: applicant.grades || "",
        notes: applicant.notes || "",
        photoUrl: applicant.passportPhoto?.url || "",
        createdBy: req.user?._id || null,
        updatedBy: req.user?._id || null,
      };

      if (modelHasPath(Student, "applicationId")) studentPayload.applicationId = applicant._id;

      student = await Student.create(studentPayload);

      if (StudentDoc) {
        await syncApplicantDocsToStudentDocs({
          StudentDoc,
          applicant: applicant.toObject ? applicant.toObject() : applicant,
          studentId: student._id,
          uploadedBy: req.user?._id || null,
        }).catch((err) => {
          console.error("SYNC APPLICANT DOCS ERROR:", err);
        });
      }

      await finalizeApplicantConversion(Applicant, {
        id: applicant._id,
        token: conversionClaim.token,
        studentId: student._id,
        regNo,
        sectionId: section._id,
      });
      conversionFinalized = true;

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
      if (conversionClaim?.token && !conversionFinalized) {
        await releaseApplicantConversion(Applicant, applicant?._id || req.params.id, conversionClaim.token);
      }

      if (student?._id && conversionFinalized) {
        req.flash?.("success", `Applicant accepted. Student created (${regNo}).`);
        req.flash?.("error", `But provisioning failed: ${err.message}`);
        return res.redirect(`/admin/students?regNo=${encodeURIComponent(regNo)}`);
      }


      if (student?._id && !conversionFinalized) {
        await Student.updateOne(
          { _id: student._id, isDeleted: { $ne: true } },
          { $set: { isDeleted: true, deletedAt: new Date(), status: "inactive" } },
        ).catch(() => null);
      }

      req.flash?.("error", err.message || "Failed to accept applicant.");
      return res.redirect(`/admin/admissions/applicants/${req.params.id}?err=accept_failed`);
    }
  },

  rejectApplicant: async (req, res) => {
    const fallback = `/admin/admissions/applicants/${req.params.id}`;
    try {
      const { Applicant } = req.models;
      if (!isValidId(req.params.id)) return res.status(404).send("Invalid applicant ID");
      const current = await Applicant.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
      if (!current) return res.status(404).send("Applicant not found");
      const target = assertApplicantTransition(current.status, "rejected");
      const reason = str(req.body.reason || req.body.notes || req.body.decisionNote || "").slice(0, 400);
      const result = await Applicant.updateOne(
        { _id: current._id, status: current.status, isDeleted: { $ne: true } },
        { $set: { status: target, decisionNote: reason, decidedAt: new Date(), decidedBy: actorUserId(req) } },
      );
      if (!result.modifiedCount && current.status !== target) throw new Error("Applicant changed while you were reviewing it. Reload and try again.");
      req.flash?.("success", "Applicant rejected.");
    } catch (err) {
      console.error("REJECT APPLICANT ERROR:", err);
      req.flash?.("error", err?.message || "Failed to reject applicant.");
    }
    return res.redirect(admissionsBackUrl(req, fallback));
  },

  bulkAction: async (req, res) => {
    try {
      const { Applicant } = req.models;
      const action = str(req.body.action);
      const message = str(req.body.message).slice(0, 400);
      const ids = str(req.body.ids).split(",").map((x) => x.trim()).filter((x) => isValidId(x));
      if (!ids.length) {
        req.flash?.("error", "No applicants selected.");
        return res.redirect(admissionsBackUrl(req, "/admin/admissions/applicants"));
      }
      const target = action === "set_under_review" ? "under_review" : action === "accept" ? "accepted" : action === "reject" ? "rejected" : "";
      if (!target) {
        req.flash?.("error", "Invalid bulk action.");
        return res.redirect(admissionsBackUrl(req, "/admin/admissions/applicants"));
      }

      const rows = await Applicant.find({ _id: { $in: ids }, isDeleted: { $ne: true } }).select("_id status").lean();
      let changed = 0;
      let skipped = 0;
      for (const row of rows) {
        try {
          const status = assertApplicantTransition(row.status, target);
          const patch = { status };
          if (["accepted", "rejected"].includes(status)) {
            patch.decidedAt = new Date();
            patch.decidedBy = actorUserId(req);
            if (message) patch.decisionNote = message;
          } else {
            patch.decidedAt = null;
            patch.decidedBy = null;
          }
          const result = await Applicant.updateOne(
            { _id: row._id, status: row.status, isDeleted: { $ne: true } },
            { $set: patch },
          );
          if (result.modifiedCount || row.status === status) changed += 1;
          else skipped += 1;
        } catch (_) {
          skipped += 1;
        }
      }
      req.flash?.("success", `Bulk action applied to ${changed} applicant${changed === 1 ? "" : "s"}.`);
      if (skipped) req.flash?.("error", `${skipped} applicant${skipped === 1 ? " was" : "s were"} skipped because the lifecycle transition was not allowed or the record changed.`);
      return res.redirect(admissionsBackUrl(req, "/admin/admissions/applicants"));
    } catch (err) {
      console.error("BULK APPLICANTS ACTION ERROR:", err);
      req.flash?.("error", "Bulk action failed.");
      return res.redirect(admissionsBackUrl(req, "/admin/admissions/applicants"));
    }
  },

  exportApplicant: async (req, res) => {
    try {
      const { Applicant } = req.models;
      if (!isValidId(req.params.id)) return res.status(404).send("Invalid applicant ID");

      const a = await Applicant.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
        .populate("section1", "code name className classLevel classStream")
        .populate("program1", "code name className classLevel classStream")
        .lean();
      if (!a) return res.status(404).send("Applicant not found");

      const sec = a.section1 || a.program1 || {};
      const stats = documentCompleteness(a);
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
        ["Required Documents Uploaded", `${stats.uploaded}/${stats.total}`],
        ["Required Documents Verified", `${stats.verified}/${stats.total}`],
        ["Interview Status", a.interviewStatus || ""],
        ["Interview At", a.interviewWhen ? new Date(a.interviewWhen).toISOString() : ""],
      ];

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${String(a.applicationId || "applicant").replace(/[^A-Za-z0-9_.-]/g, "_")}.csv"`);
      return res.send(rows.map((row) => row.map(csvCell).join(",")).join("\n"));
    } catch (err) {
      console.error("EXPORT APPLICANT ERROR:", err);
      req.flash?.("error", "Failed to export applicant.");
      return res.redirect(`/admin/admissions/applicants/${req.params.id}`);
    }
  },

  updateStatus: async (req, res) => {
    const fallback = `/admin/admissions/applicants/${req.params.id}`;
    try {
      const { Applicant } = req.models;
      if (!isValidId(req.params.id)) return res.status(404).send("Invalid applicant ID");
      const current = await Applicant.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
      if (!current) return res.status(404).send("Applicant not found");

      const requested = str(req.body.status).toLowerCase();
      if (!ALLOWED_STATUSES.includes(requested)) throw new Error("Invalid applicant status.");
      const status = assertApplicantTransition(current.status, requested);
      const now = new Date();
      const patch = {
        status,
        decisionNote: str(req.body.decisionNote || req.body.notes || "").slice(0, 400),
      };
      if (["accepted", "rejected"].includes(status)) {
        patch.decidedAt = now;
        patch.decidedBy = actorUserId(req);
      } else {
        patch.decidedAt = null;
        patch.decidedBy = null;
      }

      const result = await Applicant.updateOne(
        { _id: req.params.id, status: current.status, isDeleted: { $ne: true } },
        { $set: patch },
      );
      if (!result.modifiedCount && status !== current.status) throw new Error("Applicant changed while you were reviewing it. Reload and try again.");
      req.flash?.("success", "Applicant status updated.");
    } catch (err) {
      console.error("UPDATE APPLICANT STATUS ERROR:", err);
      req.flash?.("error", err?.message || "Failed to update status.");
    }
    return res.redirect(admissionsBackUrl(req, fallback));
  },

  shortlistApplicant: async (req, res) => {
    const fallback = `/admin/admissions/applicants/${req.params.id}`;
    try {
      const { Applicant } = req.models;
      if (!isValidId(req.params.id)) return res.status(404).send("Invalid applicant ID");
      const current = await Applicant.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
      if (!current) return res.status(404).send("Applicant not found");
      const target = assertApplicantTransition(current.status, "under_review");
      const result = await Applicant.updateOne(
        { _id: current._id, status: current.status, isDeleted: { $ne: true } },
        { $set: { status: target } },
      );
      if (!result.modifiedCount && current.status !== target) throw new Error("Applicant changed while you were reviewing it. Reload and try again.");
      req.flash?.("success", "Applicant shortlisted for review.");
    } catch (err) {
      console.error("SHORTLIST APPLICANT ERROR:", err);
      req.flash?.("error", err?.message || "Failed to shortlist applicant.");
    }
    return res.redirect(admissionsBackUrl(req, fallback));
  },

  saveNotes: async (req, res) => {
    try {
      const { Applicant } = req.models;
      if (!isValidId(req.params.id)) return res.status(404).send("Invalid applicant ID");
      await Applicant.updateOne(
        { _id: req.params.id, isDeleted: { $ne: true } },
        { $set: { adminNotes: str(req.body.adminNotes).slice(0, 1200), tags: sanitizeTags(req.body.tags) } },
      );
      req.flash?.("success", "Applicant notes saved.");
    } catch (err) {
      console.error("SAVE APPLICANT NOTES ERROR:", err);
      req.flash?.("error", "Failed to save notes.");
    }
    return res.redirect(admissionsBackUrl(req, `/admin/admissions/applicants/${req.params.id}`));
  },

  requestDocs: async (req, res) => {
    const fallback = `/admin/admissions/applicants/${req.params.id}`;
    try {
      const { Applicant } = req.models;
      if (!isValidId(req.params.id)) return res.status(404).send("Invalid applicant ID");
      const applicant = await Applicant.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
      if (!applicant) return res.status(404).send("Applicant not found");

      const via = normalizeRequestChannel(req.body.via);
      if (via !== "email") throw new Error("SMS delivery is not configured in this application. Choose Email.");
      if (!cleanEmail(applicant.email)) throw new Error("Applicant does not have a valid email address.");

      let missingKeys = normalizeRequestedDocKeys(req.body.missingKeys);
      if (!missingKeys.length) missingKeys = documentCompleteness(applicant).missingKeys;
      if (!missingKeys.length) throw new Error("All required documents are already uploaded.");

      const deadline = asDate(req.body.deadline);
      if (req.body.deadline && !deadline) throw new Error("Invalid document deadline.");
      if (deadline && deadline.getTime() < Date.now() - 60000) throw new Error("Document deadline cannot be in the past.");
      const message = str(req.body.message).slice(0, 1200);
      const mail = requestDocsEmail({
        applicant,
        keys: missingKeys,
        deadline,
        message,
        tenantName: req.tenant?.name || "Classic Academy",
      });
      await sendMail({ to: cleanEmail(applicant.email), subject: mail.subject, html: mail.html });

      applicant.requestedDocs = Array.isArray(applicant.requestedDocs) ? applicant.requestedDocs.slice(-99) : [];
      applicant.requestedDocs.push({
        missingKeys,
        via: "email",
        deadline,
        message,
        requestedAt: new Date(),
        requestedBy: actorUserId(req),
      });
      await applicant.save();
      req.flash?.("success", "Missing-document request emailed and recorded.");
    } catch (err) {
      console.error("REQUEST DOCS ERROR:", err);
      req.flash?.("error", err?.message || "Failed to request documents.");
    }
    return res.redirect(admissionsBackUrl(req, fallback));
  },

  scheduleInterview: async (req, res) => {
    const fallback = `/admin/admissions/applicants/${req.params.id}`;
    try {
      const { Applicant } = req.models;
      if (!isValidId(req.params.id)) return res.status(404).send("Invalid applicant ID");
      const applicant = await Applicant.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
      if (!applicant) return res.status(404).send("Applicant not found");
      assertApplicantTransition(applicant.status, "under_review");

      const date = str(req.body.date);
      const time = str(req.body.time);
      const when = asDate(`${date}T${time}`);
      if (!date || !time || !when) throw new Error("A valid interview date and time are required.");
      if (when.getTime() <= Date.now()) throw new Error("Interview must be scheduled in the future.");

      applicant.status = "under_review";
      applicant.interviewStatus = "Scheduled";
      applicant.interviewWhen = when;
      applicant.interviewMode = normalizeInterviewMode(req.body.mode);
      applicant.interviewPanel = str(req.body.panel).slice(0, 200);
      applicant.interviewUpdatedAt = new Date();
      applicant.interviewUpdatedBy = actorUserId(req);
      if (str(req.body.notes)) {
        applicant.adminNotes = [applicant.adminNotes, `Interview note: ${str(req.body.notes).slice(0, 600)}`]
          .filter(Boolean).join("\n").slice(-1200);
      }
      await applicant.save();

      if (cleanEmail(applicant.email)) {
        try {
          const mail = interviewEmail({ applicant, when, mode: applicant.interviewMode, panel: applicant.interviewPanel, tenantName: req.tenant?.name });
          await sendMail({ to: cleanEmail(applicant.email), subject: mail.subject, html: mail.html });
          req.flash?.("success", "Interview scheduled and applicant emailed.");
        } catch (mailErr) {
          req.flash?.("success", "Interview scheduled.");
          req.flash?.("error", `Interview email was not sent: ${mailErr.message}`);
        }
      } else {
        req.flash?.("success", "Interview scheduled. Applicant has no email address for notification.");
      }
    } catch (err) {
      console.error("SCHEDULE INTERVIEW ERROR:", err);
      req.flash?.("error", err?.message || "Failed to schedule interview.");
    }
    return res.redirect(admissionsBackUrl(req, fallback));
  },

  cancelInterview: async (req, res) => {
    const fallback = `/admin/admissions/applicants/${req.params.id}`;
    try {
      const { Applicant } = req.models;
      if (!isValidId(req.params.id)) return res.status(404).send("Invalid applicant ID");
      const applicant = await Applicant.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
      if (!applicant) return res.status(404).send("Applicant not found");
      if (!applicant.interviewWhen || String(applicant.interviewStatus).toLowerCase() === "cancelled") {
        throw new Error("There is no active interview to cancel.");
      }
      const previousWhen = applicant.interviewWhen;
      applicant.interviewStatus = "Cancelled";
      applicant.interviewUpdatedAt = new Date();
      applicant.interviewUpdatedBy = actorUserId(req);
      await applicant.save();

      if (cleanEmail(applicant.email)) {
        try {
          const mail = interviewEmail({ applicant, when: previousWhen, cancelled: true, tenantName: req.tenant?.name });
          await sendMail({ to: cleanEmail(applicant.email), subject: mail.subject, html: mail.html });
          req.flash?.("success", "Interview cancelled and applicant emailed.");
        } catch (mailErr) {
          req.flash?.("success", "Interview cancelled.");
          req.flash?.("error", `Cancellation email was not sent: ${mailErr.message}`);
        }
      } else req.flash?.("success", "Interview cancelled.");
    } catch (err) {
      console.error("CANCEL INTERVIEW ERROR:", err);
      req.flash?.("error", err?.message || "Failed to cancel interview.");
    }
    return res.redirect(admissionsBackUrl(req, fallback));
  },

  verifyDocument: async (req, res) => {
    const fallback = `/admin/admissions/applicants/${req.params.id}`;
    try {
      const { Applicant } = req.models;
      if (!isValidId(req.params.id)) return res.status(404).send("Invalid applicant ID");
      const key = normalizeRequestedDocKeys([req.params.key])[0];
      if (!key) throw new Error("Unsupported applicant document.");
      const applicant = await Applicant.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
      if (!applicant) return res.status(404).send("Applicant not found");
      const doc = applicant[key];
      if (!doc?.url) throw new Error("Upload the document before verifying it.");
      doc.verified = true;
      doc.verifiedAt = new Date();
      doc.verifiedBy = actorUserId(req);
      await applicant.save();
      req.flash?.("success", "Document verified.");
    } catch (err) {
      req.flash?.("error", err?.message || "Failed to verify document.");
    }
    return res.redirect(admissionsBackUrl(req, fallback));
  },

  verifyAllDocuments: async (req, res) => {
    const fallback = `/admin/admissions/applicants/${req.params.id}`;
    try {
      const { Applicant } = req.models;
      if (!isValidId(req.params.id)) return res.status(404).send("Invalid applicant ID");
      const applicant = await Applicant.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
      if (!applicant) return res.status(404).send("Applicant not found");
      const keys = ["idDocument", "passportPhoto", "transcript"];
      const missing = keys.filter((key) => !applicant[key]?.url);
      if (missing.length) throw new Error("All required documents must be uploaded before Verify All.");
      const now = new Date();
      for (const key of keys) {
        applicant[key].verified = true;
        applicant[key].verifiedAt = now;
        applicant[key].verifiedBy = actorUserId(req);
      }
      await applicant.save();
      req.flash?.("success", "All required documents verified.");
    } catch (err) {
      req.flash?.("error", err?.message || "Failed to verify documents.");
    }
    return res.redirect(admissionsBackUrl(req, fallback));
  },

  uploadApplicantDocument: async (req, res) => {
    const fallback = `/admin/admissions/applicants/${req.params.id}`;
    let uploaded = null;
    try {
      const { Applicant } = req.models;
      if (!isValidId(req.params.id)) return res.status(404).send("Invalid applicant ID");
      if (!req.file) throw new Error("Select a document to upload.");
      const key = str(req.body.key);
      if (!["idDocument", "passportPhoto", "transcript", "otherDocs"].includes(key)) throw new Error("Unsupported document type.");
      const applicant = await Applicant.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
      if (!applicant) return res.status(404).send("Applicant not found");

      const folder = `classic-academy/${req.tenant?.slug || req.tenant?.code || "tenant"}/admissions/${applicant.applicationId || applicant._id}`;
      uploaded = await uploadBuffer(req.file, folder, { resource_type: key === "passportPhoto" ? "image" : "auto" });
      const payload = {
        url: uploaded.secure_url,
        publicId: uploaded.public_id,
        resourceType: uploaded.resource_type || (key === "passportPhoto" ? "image" : "auto"),
        originalName: str(req.file.originalname).slice(0, 200),
        bytes: req.file.size || uploaded.bytes || 0,
        mimeType: str(req.file.mimetype).slice(0, 80),
        verified: false,
        verifiedAt: null,
        verifiedBy: null,
      };

      let oldDoc = null;
      if (key === "otherDocs") applicant.otherDocs.push(payload);
      else {
        oldDoc = applicant[key] ? { publicId: applicant[key].publicId, resourceType: applicant[key].resourceType } : null;
        applicant[key] = payload;
      }
      await applicant.save();
      if (oldDoc?.publicId) await safeDestroy(oldDoc.publicId, oldDoc.resourceType || "auto");
      req.flash?.("success", "Applicant document uploaded.");
    } catch (err) {
      if (uploaded?.public_id) await safeDestroy(uploaded.public_id, uploaded.resource_type || "auto");
      console.error("UPLOAD APPLICANT DOCUMENT ERROR:", err);
      req.flash?.("error", err?.message || "Failed to upload document.");
    }
    return res.redirect(admissionsBackUrl(req, fallback));
  },

  saveChecklist: async (req, res) => {
    try {
      const { Applicant } = req.models;
      if (!isValidId(req.params.id)) return res.status(404).send("Invalid applicant ID");
      const applicant = await Applicant.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
      if (!applicant) return res.status(404).send("Applicant not found");
      const checklist = normalizeChecklist(req.body);
      const stats = documentCompleteness(applicant);
      checklist.identityVerified = checklist.identityVerified && applicant.idDocument?.verified === true;
      checklist.documentsComplete = checklist.documentsComplete && stats.uploaded === stats.total;
      await Applicant.updateOne(
        { _id: req.params.id, isDeleted: { $ne: true } },
        { $set: { reviewChecklist: checklist, checklistUpdatedAt: new Date(), checklistUpdatedBy: actorUserId(req) } },
      );
      req.flash?.("success", "Review checklist saved.");
    } catch (err) {
      req.flash?.("error", err?.message || "Failed to save review checklist.");
    }
    return res.redirect(admissionsBackUrl(req, `/admin/admissions/applicants/${req.params.id}`));
  },

  emailApplicant: async (req, res) => {
    try {
      const { Applicant } = req.models;
      if (!isValidId(req.params.id)) return res.status(404).send("Invalid applicant ID");
      const applicant = await Applicant.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
      if (!applicant) return res.status(404).send("Applicant not found");
      const to = cleanEmail(applicant.email);
      const subject = str(req.body.subject).slice(0, 160);
      const message = str(req.body.message).slice(0, 4000);
      if (!to) throw new Error("Applicant email is unavailable.");
      if (!subject || !message) throw new Error("Email subject and message are required.");
      const html = `<p>${message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>`;
      await sendMail({ to, subject, html, text: message });
      req.flash?.("success", "Email sent to applicant.");
    } catch (err) {
      req.flash?.("error", err?.message || "Failed to email applicant.");
    }
    return res.redirect(admissionsBackUrl(req, `/admin/admissions/applicants/${req.params.id}`));
  },

  smsApplicant: async (req, res) => {
    req.flash?.("error", "SMS delivery is not available because no SMS transport is configured in this application.");
    return res.redirect(admissionsBackUrl(req, `/admin/admissions/applicants/${req.params.id}`));
  },
};
