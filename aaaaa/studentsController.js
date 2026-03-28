const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");
const { sendMail } = require("../../../utils/mailer");
const { createSetPasswordInvite } = require("../../../utils/inviteService");
const { setupPasswordEmail } = require("../../../utils/emailTemplates");

const cleanStr = (v, max = 2000) => String(v || "").trim().slice(0, max);
const isObjId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const cleanEmail = (v) => String(v || "").trim().toLowerCase();
const normalizeEmailOptional = (v, max = 120) => {
  const e = cleanStr(v, max).toLowerCase();
  return e || undefined;
};
const parseIntSafe = (v, def = 1) => {
  const n = parseInt(String(v || ""), 10);
  return Number.isFinite(n) ? n : def;
};
const escapeRegExp = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SCHOOL_LEVELS = ["nursery", "primary", "secondary"];
const CLASS_LEVELS = [
  "BABY",
  "MIDDLE",
  "TOP",
  "P1",
  "P2",
  "P3",
  "P4",
  "P5",
  "P6",
  "P7",
  "S1",
  "S2",
  "S3",
  "S4",
  "S5",
  "S6",
];

const normalizeStatus = (v) => {
  const s = String(v || "").trim().toLowerCase();
  return new Set(["active", "on_hold", "suspended", "graduated", "archived"]).has(s) ? s : null;
};

const actorObjectId = (req) => {
  const raw = req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;
  return raw && isObjId(raw) ? new mongoose.Types.ObjectId(String(raw)) : null;
};

const uniqRolesAdd = (existingRoles, role) => {
  const roles = new Set(Array.isArray(existingRoles) ? existingRoles : []);
  if (role) roles.add(role);
  return Array.from(roles);
};

function modelHasPath(Model, path) {
  try {
    return !!Model?.schema?.path(path);
  } catch (_) {
    return false;
  }
}

async function safeStudentSet(StudentModel, studentId, patch) {
  const $set = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (modelHasPath(StudentModel, k)) $set[k] = v;
  }
  if (!Object.keys($set).length) return;
  await StudentModel.updateOne({ _id: studentId }, { $set }).catch(() => {});
}

function normalizeClassLevel(v) {
  const value = String(v || "").trim().toUpperCase();
  return CLASS_LEVELS.includes(value) ? value : "";
}

function normalizeSubjectIds(v) {
  const arr = Array.isArray(v) ? v : v ? [v] : [];
  return arr
    .map((x) => String(x || "").trim())
    .filter((x) => isObjId(x))
    .map((x) => new mongoose.Types.ObjectId(x));
}

function buildStudentFilter({ q, schoolLevel, classLevel, term, status }) {
  const filter = { isDeleted: { $ne: true } };

  if (q) {
    const safe = escapeRegExp(cleanStr(q, 120));
    filter.$or = [
      { fullName: { $regex: safe, $options: "i" } },
      { regNo: { $regex: safe, $options: "i" } },
      { email: { $regex: safe, $options: "i" } },
      { phone: { $regex: safe, $options: "i" } },
    ];
  }

  if (schoolLevel && SCHOOL_LEVELS.includes(schoolLevel)) filter.schoolLevel = schoolLevel;
  if (classLevel && CLASS_LEVELS.includes(classLevel)) filter.classLevel = classLevel;
  if ([1, 2, 3].includes(Number(term))) filter.term = Number(term);
  if (status && normalizeStatus(status)) filter.status = status;

  return filter;
}

async function kpiAgg(Student, match) {
  const rows = await Student.aggregate([
    { $match: match },
    { $group: { _id: "$status", c: { $sum: 1 } } },
  ]);

  const m = Object.fromEntries(rows.map((r) => [r._id, r.c]));
  const total = Object.values(m).reduce((a, b) => a + b, 0);

  return {
    total,
    active: m.active || 0,
    on_hold: m.on_hold || 0,
    suspended: m.suspended || 0,
    graduated: m.graduated || 0,
    archived: m.archived || 0,
  };
}

async function findOrCreateStudentUser({ req, StudentDoc, User }) {
  const email = cleanEmail(StudentDoc?.email);
  const fullName = cleanStr(StudentDoc?.fullName, 120);
  const firstName = cleanStr(StudentDoc?.firstName, 60) || fullName.split(" ")[0] || "Student";
  const lastName = cleanStr(StudentDoc?.lastName, 60) || fullName.split(" ").slice(1).join(" ") || "Account";

  if (StudentDoc?.userId && isObjId(StudentDoc.userId)) {
    const u = await User.findOne({ _id: StudentDoc.userId, deletedAt: null }).select("+passwordHash roles status tokenVersion email firstName lastName");
    if (u) return u;
  }

  let u = await User.findOne({ studentId: StudentDoc._id, deletedAt: null }).select("+passwordHash roles status tokenVersion email firstName lastName");
  if (u) return u;

  if (email) {
    u = await User.findOne({ email, deletedAt: null }).select("+passwordHash roles status tokenVersion email firstName lastName");
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
    createdBy: actorObjectId(req) || undefined,
  });

  await safeStudentSet(req.models.Student, StudentDoc._id, { userId: created._id });
  return created;
}

async function findOrCreateParentUser({ req, StudentDoc, User }) {
  const guardianEmail = cleanEmail(StudentDoc?.guardianEmail);
  const guardianName = cleanStr(StudentDoc?.guardianName, 120) || "Parent Account";
  const firstName = guardianName.split(" ")[0] || "Parent";
  const lastName = guardianName.split(" ").slice(1).join(" ") || "Account";

  if (StudentDoc?.guardianUserId && isObjId(StudentDoc.guardianUserId)) {
    const u = await User.findOne({ _id: StudentDoc.guardianUserId, deletedAt: null }).select("+passwordHash roles status tokenVersion email firstName lastName childrenStudentIds");
    if (u) return u;
  }

  if (guardianEmail) {
    const u = await User.findOne({ email: guardianEmail, deletedAt: null }).select("+passwordHash roles status tokenVersion email firstName lastName childrenStudentIds");
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
    createdBy: actorObjectId(req) || undefined,
  });

  await safeStudentSet(req.models.Student, StudentDoc._id, { guardianUserId: created._id });
  return created;
}

async function ensureParentRecord({ req, parentUser, studentId, StudentDoc }) {
  const { Parent } = req.models;
  if (!Parent || !parentUser?._id) return;

  const email = cleanEmail(parentUser.email);
  if (!email) return;

  const guardianName = cleanStr(StudentDoc?.guardianName, 120) || "";
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

  await Parent.updateOne(
    { _id: p._id },
    {
      $set: {
        userId: p.userId || parentUser._id,
        firstName: p.firstName || firstName,
        lastName: p.lastName || lastName,
        phone: p.phone || parentUser.phone || StudentDoc?.guardianPhone || "",
        childrenStudentIds: Array.from(kids),
      },
    }
  ).catch(() => {});
}

async function sendSetupInvitesToStudentAndParent({ req, studentUser, parentUser }) {
  const { InviteToken } = req.models || {};
  if (!InviteToken) throw new Error("InviteToken model missing");

  const appName = process.env.APP_NAME || "Classic Academy";
  const createdBy = req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;

  const stInvite = await createSetPasswordInvite({ req, InviteToken, userId: studentUser._id, createdBy });
  await sendMail({
    to: studentUser.email,
    subject: `${appName}: Set your password`,
    html: setupPasswordEmail({ appName, firstName: studentUser.firstName, inviteLink: stInvite.inviteLink }),
  });

  const paInvite = await createSetPasswordInvite({ req, InviteToken, userId: parentUser._id, createdBy });
  await sendMail({
    to: parentUser.email,
    subject: `${appName}: Set your password (Parent account)`,
    html: setupPasswordEmail({ appName, firstName: parentUser.firstName, inviteLink: paInvite.inviteLink }),
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      cur += '"';
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === ',') {
      row.push(cur);
      cur = "";
      continue;
    }
    if (!inQuotes && ch === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      continue;
    }
    if (ch !== '\r') cur += ch;
  }

  row.push(cur);
  rows.push(row);
  return rows.filter((r) => r.some((x) => String(x || "").trim() !== ""));
}

const csvEsc = (s) => {
  const v = String(s ?? "");
  return /[,"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

const studentRules = [
  body("regNo").trim().isLength({ min: 2, max: 60 }).withMessage("RegNo is required (2-60 chars)."),
  body("fullName").optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
  body("firstName").optional({ checkFalsy: true }).trim().isLength({ max: 60 }),
  body("middleName").optional({ checkFalsy: true }).trim().isLength({ max: 60 }),
  body("lastName").optional({ checkFalsy: true }).trim().isLength({ max: 60 }),
  body("email").optional({ checkFalsy: true }).isEmail().withMessage("Invalid email.").normalizeEmail(),
  body("phone").optional({ checkFalsy: true }).trim().isLength({ max: 40 }),

  body("schoolLevel")
    .trim()
    .isIn(SCHOOL_LEVELS)
    .withMessage("Invalid school level."),

  body("classLevel")
    .trim()
    .custom((v) => CLASS_LEVELS.includes(String(v || "").trim().toUpperCase()))
    .withMessage("Invalid class level."),

  body("term")
    .optional({ checkFalsy: true })
    .isInt({ min: 1, max: 3 })
    .toInt()
    .withMessage("Term must be 1-3."),

  body("academicYear").optional({ checkFalsy: true }).trim().isLength({ max: 20 }),
  body("status").optional({ checkFalsy: true }).custom((v) => !!normalizeStatus(v)).withMessage("Invalid status."),
  body("subjects")
    .optional()
    .custom((v) => {
      const arr = Array.isArray(v) ? v : v ? [v] : [];
      return arr.every((id) => isObjId(id));
    })
    .withMessage("Invalid subject selection."),

  body("holdType").optional({ checkFalsy: true }).trim().isLength({ max: 60 }),
  body("holdReason").optional({ checkFalsy: true }).trim().isLength({ max: 200 }),
  body("gender").optional({ checkFalsy: true }).trim().isLength({ max: 30 }),
  body("nationality").optional({ checkFalsy: true }).trim().isLength({ max: 60 }),
  body("address").optional({ checkFalsy: true }).trim().isLength({ max: 200 }),
  body("guardianName").optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
  body("guardianPhone").optional({ checkFalsy: true }).trim().isLength({ max: 40 }),
  body("guardianEmail").optional({ checkFalsy: true }).isEmail().withMessage("Invalid guardian email.").normalizeEmail(),
];

module.exports = {
  studentRules,

  resendSetupLink: async (req, res) => {
    try {
      const { Student, User, InviteToken } = req.models || {};
      if (!Student || !User || !InviteToken) return res.status(500).send("Tenant models missing");

      const id = cleanStr(req.params.id, 80);
      if (!isObjId(id)) {
        req.flash?.("error", "Invalid student id.");
        return res.redirect("back");
      }

      const student = await Student.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
      if (!student) {
        req.flash?.("error", "Student not found.");
        return res.redirect("back");
      }

      const user = await findOrCreateStudentUser({ req, StudentDoc: student, User });
      if (!user) {
        req.flash?.("error", "Student user not found and cannot be created (missing email).");
        return res.redirect("back");
      }

      const force = String(req.query.force || req.body.force || "") === "1";
      const hasPassword = !!user.passwordHash;
      if (!force && user.status === "active" && hasPassword) {
        req.flash?.("error", "Student already set a password. Use Forgot Password or resend with force.");
        return res.redirect("back");
      }

      await User.updateOne(
        { _id: user._id, deletedAt: null },
        { $set: { roles: uniqRolesAdd(user.roles, "student"), status: hasPassword ? user.status : "invited" } }
      );

      const invite = await createSetPasswordInvite({
        req,
        InviteToken,
        userId: user._id,
        createdBy: req.user?.userId || req.user?._id || null,
      });

      const appName = process.env.APP_NAME || "Classic Academy";
      await sendMail({
        to: user.email,
        subject: `${appName}: Set your password`,
        html: setupPasswordEmail({ appName, firstName: user.firstName, inviteLink: invite.inviteLink }),
      });

      req.flash?.("success", `Setup link sent to student: ${user.email}`);
      return res.redirect("back");
    } catch (err) {
      console.error("RESEND STUDENT SETUP ERROR:", err);
      req.flash?.("error", err.message || "Failed to resend setup link.");
      return res.redirect("back");
    }
  },

  list: async (req, res) => {
    try {
      if (!req.models?.Student) return res.status(500).send("Tenant models missing");

      const { Student, Subject } = req.models;
      const q = cleanStr(req.query.q, 120);
      const schoolLevel = cleanStr(req.query.schoolLevel, 30).toLowerCase();
      const classLevel = normalizeClassLevel(req.query.classLevel);
      const term = cleanStr(req.query.term, 10);
      const status = cleanStr(req.query.status, 20);

      const page = Math.max(parseIntSafe(req.query.page, 1), 1);
      const perPage = 10;
      const filter = buildStudentFilter({ q, schoolLevel, classLevel, term, status });

      const total = await Student.countDocuments(filter);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);
      const skip = (safePage - 1) * perPage;

      const [students, subjects, kpis] = await Promise.all([
        Student.find(filter)
          .select([
            "_id",
            "regNo",
            "fullName",
            "firstName",
            "middleName",
            "lastName",
            "email",
            "phone",
            "schoolLevel",
            "classLevel",
            "subjects",
            "academicYear",
            "term",
            "status",
            "holdType",
            "holdReason",
            "gender",
            "nationality",
            "address",
            "guardianName",
            "guardianPhone",
            "guardianEmail",
            "createdAt",
          ].join(" "))
          .populate("subjects", "title code shortTitle schoolLevel classLevels term status")
          .sort({ createdAt: -1, _id: -1 })
          .skip(skip)
          .limit(perPage)
          .lean(),
        Subject
          ? Subject.find({ status: { $ne: "archived" } })
              .select("_id title code shortTitle schoolLevel classLevels term status")
              .sort({ title: 1, code: 1 })
              .lean()
          : [],
        kpiAgg(Student, filter),
      ]);

      const exportQuery = new URLSearchParams({
        ...(q ? { q } : {}),
        ...(schoolLevel ? { schoolLevel } : {}),
        ...(classLevel ? { classLevel } : {}),
        ...(term ? { term } : {}),
        ...(status ? { status } : {}),
      }).toString();

      return res.render("tenant/students/index", {
        tenant: req.tenant || null,
        students,
        subjects,
        classLevels: CLASS_LEVELS,
        kpis,
        csrfToken: res.locals.csrfToken || null,
        exportQuery,
        query: { q, schoolLevel, classLevel, term, status, page: safePage, perPage, total, totalPages },
        messages: {
          success: req.flash ? req.flash("success") : [],
          error: req.flash ? req.flash("error") : [],
        },
      });
    } catch (err) {
      console.error("STUDENTS LIST ERROR:", err);
      return res.status(500).send("Failed to load students.");
    }
  },

  create: async (req, res) => {
    if (!req.models?.Student) return res.status(500).send("Tenant models missing");

    const { Student } = req.models;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/tenant/students");
    }

    try {
      const regNo = cleanStr(req.body.regNo, 60).replace(/\s+/g, " ");
      const exists = await Student.findOne({ regNo, isDeleted: { $ne: true } }).lean();
      if (exists) {
        req.flash?.("error", "RegNo already exists.");
        return res.redirect("/tenant/students");
      }

      const status = normalizeStatus(req.body.status) || "active";
      const actorId = actorObjectId(req);

      const doc = {
        regNo,
        fullName: cleanStr(req.body.fullName, 120),
        firstName: cleanStr(req.body.firstName, 60),
        middleName: cleanStr(req.body.middleName, 60),
        lastName: cleanStr(req.body.lastName, 60),
        email: normalizeEmailOptional(req.body.email),
        phone: cleanStr(req.body.phone, 40) || undefined,
        schoolLevel: SCHOOL_LEVELS.includes(req.body.schoolLevel) ? req.body.schoolLevel : "primary",
        classLevel: normalizeClassLevel(req.body.classLevel),
        subjects: normalizeSubjectIds(req.body.subjects),
        academicYear: cleanStr(req.body.academicYear, 20) || undefined,
        term: [1, 2, 3].includes(Number(req.body.term)) ? Number(req.body.term) : 1,
        status,
        holdType: cleanStr(req.body.holdType, 60) || undefined,
        holdReason: cleanStr(req.body.holdReason, 200) || undefined,
        gender: cleanStr(req.body.gender, 30) || undefined,
        nationality: cleanStr(req.body.nationality, 60) || undefined,
        address: cleanStr(req.body.address, 200) || undefined,
        guardianName: cleanStr(req.body.guardianName, 120) || undefined,
        guardianPhone: cleanStr(req.body.guardianPhone, 40) || undefined,
        guardianEmail: normalizeEmailOptional(req.body.guardianEmail),
        createdBy: actorId || undefined,
      };

      const createdStudent = await Student.create(doc);

      try {
        const { User } = req.models || {};
        if (!User) throw new Error("User model missing");

        const studentUser = await findOrCreateStudentUser({ req, StudentDoc: createdStudent, User });
        const parentUser = await findOrCreateParentUser({ req, StudentDoc: createdStudent, User });

        if (!studentUser) throw new Error("Student user cannot be created (missing student email).");
        if (!parentUser) throw new Error("Parent user cannot be created (missing guardian email).");

        await User.updateOne(
          { _id: studentUser._id, deletedAt: null },
          {
            $set: {
              roles: uniqRolesAdd(studentUser.roles, "student"),
              status: studentUser.passwordHash ? studentUser.status : "invited",
              studentId: studentUser.studentId || createdStudent._id,
            },
          }
        );

        const kids = new Set((parentUser.childrenStudentIds || []).map(String));
        kids.add(String(createdStudent._id));

        await User.updateOne(
          { _id: parentUser._id, deletedAt: null },
          {
            $set: {
              roles: uniqRolesAdd(parentUser.roles, "parent"),
              status: parentUser.passwordHash ? parentUser.status : "invited",
              childrenStudentIds: Array.from(kids),
            },
          }
        );

        await ensureParentRecord({ req, parentUser, studentId: createdStudent._id, StudentDoc: createdStudent });
        await sendSetupInvitesToStudentAndParent({ req, studentUser, parentUser });

        req.flash?.("success", "Student created. Setup links emailed to student + parent.");
      } catch (e) {
        console.error("AUTO PARENT+INVITE ERROR:", e);
        req.flash?.("success", "Student created.");
        req.flash?.("error", `But setup emails failed: ${e.message}`);
      }

      return res.redirect("/tenant/students");
    } catch (err) {
      console.error("STUDENT CREATE ERROR:", err);
      req.flash?.("error", String(err?.code) === "11000" ? "RegNo already exists." : "Failed to create student.");
      return res.redirect("/tenant/students");
    }
  },

  update: async (req, res) => {
    if (!req.models?.Student) return res.status(500).send("Tenant models missing");

    const { Student } = req.models;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/tenant/students");
    }

    try {
      const id = cleanStr(req.params.id, 80);
      if (!isObjId(id)) {
        req.flash?.("error", "Invalid student id.");
        return res.redirect("/tenant/students");
      }

      const regNo = cleanStr(req.body.regNo, 60).replace(/\s+/g, " ");
      const collision = await Student.findOne({ regNo, _id: { $ne: id }, isDeleted: { $ne: true } }).lean();
      if (collision) {
        req.flash?.("error", "RegNo already exists.");
        return res.redirect("/tenant/students");
      }

      const actorId = actorObjectId(req);

      await Student.updateOne(
        { _id: id },
        {
          $set: {
            regNo,
            fullName: cleanStr(req.body.fullName, 120),
            firstName: cleanStr(req.body.firstName, 60),
            middleName: cleanStr(req.body.middleName, 60),
            lastName: cleanStr(req.body.lastName, 60),
            email: normalizeEmailOptional(req.body.email),
            phone: cleanStr(req.body.phone, 40) || undefined,
            schoolLevel: SCHOOL_LEVELS.includes(req.body.schoolLevel) ? req.body.schoolLevel : "primary",
            classLevel: normalizeClassLevel(req.body.classLevel),
            subjects: normalizeSubjectIds(req.body.subjects),
            academicYear: cleanStr(req.body.academicYear, 20) || undefined,
            term: [1, 2, 3].includes(Number(req.body.term)) ? Number(req.body.term) : 1,
            status: normalizeStatus(req.body.status) || "active",
            holdType: cleanStr(req.body.holdType, 60) || undefined,
            holdReason: cleanStr(req.body.holdReason, 200) || undefined,
            gender: cleanStr(req.body.gender, 30) || undefined,
            nationality: cleanStr(req.body.nationality, 60) || undefined,
            address: cleanStr(req.body.address, 200) || undefined,
            guardianName: cleanStr(req.body.guardianName, 120) || undefined,
            guardianPhone: cleanStr(req.body.guardianPhone, 40) || undefined,
            guardianEmail: normalizeEmailOptional(req.body.guardianEmail),
            updatedBy: actorId || undefined,
          },
        },
        { runValidators: true }
      );

      req.flash?.("success", "Student updated.");
      return res.redirect("/tenant/students");
    } catch (err) {
      console.error("STUDENT UPDATE ERROR:", err);
      req.flash?.("error", String(err?.code) === "11000" ? "RegNo already exists." : "Failed to update student.");
      return res.redirect("/tenant/students");
    }
  },

  archive: async (req, res) => {
    try {
      const { Student } = req.models;
      const id = cleanStr(req.params.id, 80);
      if (!isObjId(id)) {
        req.flash?.("error", "Invalid student id.");
        return res.redirect("/tenant/students");
      }

      await Student.updateOne({ _id: id }, { $set: { status: "archived" } });
      req.flash?.("success", "Student archived.");
      return res.redirect("/tenant/students");
    } catch (err) {
      console.error("STUDENT ARCHIVE ERROR:", err);
      req.flash?.("error", "Failed to archive student.");
      return res.redirect("/tenant/students");
    }
  },

  remove: async (req, res) => {
    try {
      const { Student } = req.models;
      const id = cleanStr(req.params.id, 80);
      if (!isObjId(id)) {
        req.flash?.("error", "Invalid student id.");
        return res.redirect("/tenant/students");
      }

      await Student.updateOne(
        { _id: id },
        { $set: { isDeleted: true, deletedAt: new Date(), status: "archived" } }
      );

      req.flash?.("success", "Student deleted (soft).");
      return res.redirect("/tenant/students");
    } catch (err) {
      console.error("STUDENT DELETE ERROR:", err);
      req.flash?.("error", "Failed to delete student.");
      return res.redirect("/tenant/students");
    }
  },

  bulk: async (req, res) => {
    try {
      const { Student } = req.models;
      const action = cleanStr(req.body.action, 40).toLowerCase();
      const ids = String(req.body.ids || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => isObjId(x));

      if (!ids.length) {
        req.flash?.("error", "No students selected.");
        return res.redirect("/tenant/students");
      }

      if (action === "set_status") {
        const status = normalizeStatus(req.body.status);
        if (!status) {
          req.flash?.("error", "Choose a valid status.");
          return res.redirect("/tenant/students");
        }
        await Student.updateMany({ _id: { $in: ids } }, { $set: { status } });
        req.flash?.("success", `Updated status for ${ids.length} student(s).`);
        return res.redirect("/tenant/students");
      }

      if (action === "set_hold") {
        const holdType = cleanStr(req.body.holdType, 60);
        const holdReason = cleanStr(req.body.holdReason, 200);
        if (!holdType) {
          req.flash?.("error", "Hold type is required.");
          return res.redirect("/tenant/students");
        }
        await Student.updateMany(
          { _id: { $in: ids } },
          { $set: { status: "on_hold", holdType, holdReason } }
        );
        req.flash?.("success", `Hold applied to ${ids.length} student(s).`);
        return res.redirect("/tenant/students");
      }

      if (action === "clear_hold") {
        await Student.updateMany(
          { _id: { $in: ids } },
          { $set: { holdType: "", holdReason: "", holdUntil: null } }
        );
        await Student.updateMany(
          { _id: { $in: ids }, status: "on_hold" },
          { $set: { status: "active" } }
        );
        req.flash?.("success", `Hold cleared for ${ids.length} student(s).`);
        return res.redirect("/tenant/students");
      }

      if (action === "archive") {
        await Student.updateMany({ _id: { $in: ids } }, { $set: { status: "archived" } });
        req.flash?.("success", `Archived ${ids.length} student(s).`);
        return res.redirect("/tenant/students");
      }

      if (action === "delete") {
        await Student.updateMany(
          { _id: { $in: ids } },
          { $set: { isDeleted: true, deletedAt: new Date(), status: "archived" } }
        );
        req.flash?.("success", `Deleted (soft) ${ids.length} student(s).`);
        return res.redirect("/tenant/students");
      }

      req.flash?.("error", "Invalid bulk action.");
      return res.redirect("/tenant/students");
    } catch (err) {
      console.error("STUDENT BULK ERROR:", err);
      req.flash?.("error", "Bulk action failed.");
      return res.redirect("/tenant/students");
    }
  },

  importCsv: async (req, res) => {
    try {
      const { Student, Subject } = req.models;
      const actorId = actorObjectId(req);

      if (!req.file?.buffer) {
        req.flash?.("error", "CSV file is required.");
        return res.redirect("/tenant/students");
      }

      const text = req.file.buffer.toString("utf8");
      const rows = parseCsv(text);
      if (!rows.length) {
        req.flash?.("error", "CSV is empty.");
        return res.redirect("/tenant/students");
      }

      const headers = rows[0].map((h) => cleanStr(h, 60));
      const idx = (name) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());

      const iReg = idx("regNo");
      const iFull = idx("fullName");
      const iEmail = idx("email");
      const iPhone = idx("phone");
      const iSchool = idx("schoolLevel");
      const iClass = idx("classLevel");
      const iTerm = idx("term");
      const iAcad = idx("academicYear");
      const iStatus = idx("status");
      const iSubjectCodes = idx("subjectCodes");
      const iHoldType = idx("holdType");
      const iHoldReason = idx("holdReason");

      if (iReg < 0) {
        req.flash?.("error", "CSV must include header: regNo");
        return res.redirect("/tenant/students");
      }

      const subjectByCode = new Map();
      if (Subject) {
        const subjectDocs = await Subject.find({ status: { $ne: "archived" } }).select("_id code").lean();
        subjectDocs.forEach((s) => {
          const code = String(s.code || "").trim().toUpperCase();
          if (code) subjectByCode.set(code, s);
        });
      }

      const ops = [];
      let processed = 0;

      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const regNo = cleanStr(row[iReg], 60).replace(/\s+/g, " ");
        if (!regNo) continue;

        const fullName = iFull >= 0 ? cleanStr(row[iFull], 120) : "";
        const email = iEmail >= 0 ? normalizeEmailOptional(row[iEmail]) : undefined;
        const phone = iPhone >= 0 ? cleanStr(row[iPhone], 40) || undefined : undefined;
        const schoolLevel = iSchool >= 0 && SCHOOL_LEVELS.includes(String(row[iSchool] || "").trim().toLowerCase())
          ? String(row[iSchool] || "").trim().toLowerCase()
          : "";
        const classLevel = iClass >= 0 ? normalizeClassLevel(row[iClass]) : "";
        const term = iTerm >= 0 && [1, 2, 3].includes(Number(row[iTerm])) ? Number(row[iTerm]) : 1;
        const academicYear = iAcad >= 0 ? cleanStr(row[iAcad], 20) : "";
        const status = iStatus >= 0 ? normalizeStatus(row[iStatus]) || "active" : "active";
        const holdType = iHoldType >= 0 ? cleanStr(row[iHoldType], 60) : "";
        const holdReason = iHoldReason >= 0 ? cleanStr(row[iHoldReason], 200) : "";

        let subjects = [];
        if (iSubjectCodes >= 0) {
          const rawCodes = String(row[iSubjectCodes] || "")
            .split("|")
            .map((x) => String(x || "").trim().toUpperCase())
            .filter(Boolean);

          subjects = rawCodes
            .map((code) => subjectByCode.get(code))
            .filter(Boolean)
            .map((s) => s._id);
        }

        const canInsert = !!(schoolLevel && classLevel);

        ops.push({
          updateOne: {
            filter: { regNo, isDeleted: { $ne: true } },
            update: {
              $set: {
                regNo,
                fullName,
                ...(email ? { email } : {}),
                ...(phone ? { phone } : {}),
                ...(schoolLevel ? { schoolLevel } : {}),
                ...(classLevel ? { classLevel } : {}),
                term,
                academicYear,
                status,
                holdType,
                holdReason,
                subjects,
                ...(actorId ? { updatedBy: actorId } : {}),
              },
              ...(canInsert
                ? {
                    $setOnInsert: {
                      ...(actorId ? { createdBy: actorId } : {}),
                      schoolLevel,
                      classLevel,
                    },
                  }
                : {}),
            },
            upsert: canInsert,
          },
        });

        processed++;
        if (ops.length >= 500) {
          await Student.bulkWrite(ops, { ordered: false });
          ops.length = 0;
        }
      }

      if (ops.length) await Student.bulkWrite(ops, { ordered: false });

      if (!processed) {
        req.flash?.("error", "No valid rows imported.");
        return res.redirect("/tenant/students");
      }

      req.flash?.("success", `Imported/updated ${processed} row(s). New inserts require schoolLevel + classLevel.`);
      return res.redirect("/tenant/students");
    } catch (err) {
      console.error("STUDENT IMPORT ERROR:", err);
      req.flash?.("error", String(err?.code) === "11000" ? "Import failed: duplicate regNo exists." : "Import failed. Check CSV headers and values.");
      return res.redirect("/tenant/students");
    }
  },

  exportCsv: async (req, res) => {
    try {
      const { Student, Subject } = req.models;
      const q = cleanStr(req.query.q, 120);
      const schoolLevel = cleanStr(req.query.schoolLevel, 30).toLowerCase();
      const classLevel = normalizeClassLevel(req.query.classLevel);
      const term = cleanStr(req.query.term, 10);
      const status = cleanStr(req.query.status, 20);
      const filter = buildStudentFilter({ q, schoolLevel, classLevel, term, status });

      const [rows, subjectDocs] = await Promise.all([
        Student.find(filter)
          .select("regNo fullName email phone schoolLevel classLevel subjects academicYear term status holdType holdReason createdAt")
          .sort({ createdAt: -1, _id: -1 })
          .lean(),
        Subject ? Subject.find({}).select("_id code").lean() : Promise.resolve([]),
      ]);

      const subjectMap = new Map((subjectDocs || []).map((s) => [String(s._id), s.code || ""]));

      const header = [
        "regNo",
        "fullName",
        "email",
        "phone",
        "schoolLevel",
        "classLevel",
        "term",
        "academicYear",
        "status",
        "subjectCodes",
        "holdType",
        "holdReason",
      ];
      const lines = [header.join(",")];

      rows.forEach((s) => {
        const subjectCodes = Array.isArray(s.subjects)
          ? s.subjects
              .map((id) => subjectMap.get(String(id)) || "")
              .filter(Boolean)
              .join("|")
          : "";

        lines.push(
          [
            csvEsc(s.regNo || ""),
            csvEsc(s.fullName || ""),
            csvEsc(s.email || ""),
            csvEsc(s.phone || ""),
            csvEsc(s.schoolLevel || ""),
            csvEsc(s.classLevel || ""),
            csvEsc(s.term ?? 1),
            csvEsc(s.academicYear || ""),
            csvEsc(s.status || ""),
            csvEsc(subjectCodes),
            csvEsc(s.holdType || ""),
            csvEsc(s.holdReason || ""),
          ].join(",")
        );
      });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="students_export.csv"');
      return res.send(lines.join("\n"));
    } catch (err) {
      console.error("STUDENT EXPORT ERROR:", err);
      req.flash?.("error", "Export failed.");
      return res.redirect("/tenant/students");
    }
  },
};