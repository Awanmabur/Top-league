const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");
const { sendMail } = require("../../../utils/mailer");
const { createSetPasswordInvite } = require("../../../utils/inviteService");
const { setupPasswordEmail } = require("../../../utils/emailTemplates");

let importedNextRegNo = null;
try {
  ({ nextRegNo: importedNextRegNo } = require("../../../utils/regNo"));
} catch (_) {}

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
  "P8",
  "S1",
  "S2",
  "S3",
  "S4",
  "S5",
  "S6",
];
const LEVEL_CLASS_MAP = {
  nursery: ["BABY", "MIDDLE", "TOP"],
  primary: ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"],
  secondary: ["S1", "S2", "S3", "S4", "S5", "S6"],
};

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

function normalizeSchoolLevel(v) {
  const value = String(v || "").trim().toLowerCase();
  return SCHOOL_LEVELS.includes(value) ? value : "";
}

function normalizeSubjectIds(v) {
  const arr = Array.isArray(v) ? v : v ? [v] : [];
  return arr
    .map((x) => String(x || "").trim())
    .filter((x) => isObjId(x))
    .map((x) => new mongoose.Types.ObjectId(x));
}

function getSchoolUnits(req) {
  return req.tenantDoc?.settings?.academics?.schoolUnits
    || req.tenant?.settings?.academics?.schoolUnits
    || [];
}

function buildStructure(req) {
  return (getSchoolUnits(req) || []).map((schoolUnit) => ({
    id: String(schoolUnit.id || schoolUnit._id || ""),
    name: schoolUnit.name || "",
    code: schoolUnit.code || "",
    campuses: (schoolUnit.campuses || []).map((campus) => ({
      id: String(campus.id || campus._id || ""),
      name: campus.name || "",
      code: campus.code || "",
      levels: (campus.levels || []).map((level) => ({
        id: String(level.id || level._id || ""),
        name: level.name || "",
        type: String(level.type || "").toLowerCase(),
        code: level.code || "",
        sections: (level.sections || []).map((section) => ({
          id: String(section.id || section._id || ""),
          name: section.name || section.title || section.code || "",
          code: section.code || "",
        })),
      })),
    })),
  }));
}

function getPlacement(req, schoolUnitId, campusId, schoolLevel) {
  for (const schoolUnit of getSchoolUnits(req)) {
    const suId = String(schoolUnit.id || schoolUnit._id || "");
    if (schoolUnitId && suId !== String(schoolUnitId)) continue;

    for (const campus of schoolUnit.campuses || []) {
      const cpId = String(campus.id || campus._id || "");
      if (campusId && cpId !== String(campusId)) continue;

      const level = (campus.levels || []).find(
        (l) => String(l.type || "").toLowerCase() === String(schoolLevel || "").toLowerCase()
      );

      return {
        schoolUnit,
        campus,
        level: level || null,
      };
    }
  }
  return null;
}

function buildStudentFilter({ q, schoolLevel, classLevel, term, status, schoolUnitId, campusId, classId, section }) {
  const filter = { isDeleted: { $ne: true } };

  if (q) {
    const safe = escapeRegExp(cleanStr(q, 120));
    filter.$or = [
      { fullName: { $regex: safe, $options: "i" } },
      { regNo: { $regex: safe, $options: "i" } },
      { email: { $regex: safe, $options: "i" } },
      { phone: { $regex: safe, $options: "i" } },
      { className: { $regex: safe, $options: "i" } },
      { campusName: { $regex: safe, $options: "i" } },
      { schoolUnitName: { $regex: safe, $options: "i" } },
      { section: { $regex: safe, $options: "i" } },
    ];
  }

  if (schoolLevel && SCHOOL_LEVELS.includes(schoolLevel)) filter.schoolLevel = schoolLevel;
  if (classLevel && CLASS_LEVELS.includes(classLevel)) filter.classLevel = classLevel;
  if ([1, 2, 3].includes(Number(term))) filter.term = Number(term);
  if (status && normalizeStatus(status)) filter.status = status;
  if (schoolUnitId) filter.schoolUnitId = schoolUnitId;
  if (campusId) filter.campusId = campusId;
  if (classId) filter.classId = classId;
  if (section) filter.section = section;

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

function fallbackRegNo(existingValues = [], year = new Date().getFullYear()) {
  let max = 0;
  for (const raw of existingValues) {
    const value = String(raw || "");
    const m = value.match(/(\d+)(?!.*\d)/);
    if (!m) continue;
    max = Math.max(max, Number(m[1] || 0));
  }
  return `REG/${year}/${String(max + 1).padStart(4, "0")}`;
}

async function generateRegNo({ req, Student, schoolLevel, classLevel }) {
  if (typeof importedNextRegNo === "function") {
    try {
      const generated = await importedNextRegNo({
        req,
        Student,
        schoolLevel,
        classLevel,
      });
      if (generated) return String(generated).trim();
    } catch (err) {
      console.error("nextRegNo fallback to local generator:", err.message);
    }
  }

  const existing = await Student.find({ isDeleted: { $ne: true } }).select("regNo createdAt").sort({ createdAt: -1 }).lean();
  return fallbackRegNo(existing.map((x) => x.regNo));
}

async function findOrCreateStudentUser({ req, StudentDoc, User }) {
  const email = cleanEmail(StudentDoc?.email);
  const fullName = cleanStr(StudentDoc?.fullName, 120);
  const firstName = cleanStr(StudentDoc?.firstName, 60) || fullName.split(" ")[0] || "Student";
  const lastName = cleanStr(StudentDoc?.lastName, 60) || fullName.split(" ").slice(1).join(" ") || "Account";

  if (StudentDoc?.userId && isObjId(StudentDoc.userId)) {
    const u = await User.findOne({ _id: StudentDoc.userId, deletedAt: null }).select("+passwordHash roles status tokenVersion email firstName lastName studentId");
    if (u) return u;
  }

  if (email) {
    const u = await User.findOne({ email, deletedAt: null }).select("+passwordHash roles status tokenVersion email firstName lastName studentId");
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
  const { Parent } = req.models || {};
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

async function sendInviteIfPossible({ req, user, roleLabel }) {
  const { InviteToken } = req.models || {};
  if (!InviteToken || !user?.email || user.passwordHash) return false;

  const appName = process.env.APP_NAME || "Classic Academy";
  const createdBy = req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;

  const invite = await createSetPasswordInvite({ req, InviteToken, userId: user._id, createdBy });
  await sendMail({
    to: user.email,
    subject: `${appName}: Set your password`,
    html: setupPasswordEmail({ appName, firstName: user.firstName || roleLabel, inviteLink: invite.inviteLink }),
  });

  return true;
}

async function enrichFromSelectedClass({ req, payload }) {
  const { Class } = req.models || {};
  const classId = cleanStr(payload.classId, 80);
  if (!Class || !classId || !isObjId(classId)) return payload;

  const classDoc = await Class.findOne({ _id: classId }).lean().catch(() => null);
  if (!classDoc) return payload;

  return {
    ...payload,
    classId: String(classDoc._id),
    className: classDoc.name || payload.className,
    classCode: classDoc.code || payload.classCode,
    section: cleanStr(classDoc.stream || classDoc.section || payload.section, 40) || undefined,
    stream: cleanStr(classDoc.stream || classDoc.section || payload.stream, 40) || undefined,
    schoolUnitId: cleanStr(classDoc.schoolUnitId || payload.schoolUnitId, 80) || undefined,
    schoolUnitName: cleanStr(classDoc.schoolUnitName || payload.schoolUnitName, 180) || undefined,
    schoolUnitCode: cleanStr(classDoc.schoolUnitCode || payload.schoolUnitCode, 40) || undefined,
    campusId: cleanStr(classDoc.campusId || payload.campusId, 80) || undefined,
    campusName: cleanStr(classDoc.campusName || payload.campusName, 180) || undefined,
    campusCode: cleanStr(classDoc.campusCode || payload.campusCode, 40) || undefined,
    schoolLevel: normalizeSchoolLevel(classDoc.levelType || payload.schoolLevel) || payload.schoolLevel,
    classLevel: normalizeClassLevel(classDoc.classLevel || payload.classLevel) || payload.classLevel,
    academicYear: cleanStr(classDoc.academicYear || payload.academicYear, 20) || payload.academicYear,
    term: [1, 2, 3].includes(Number(classDoc.term)) ? Number(classDoc.term) : payload.term,
  };
}

function applyPlacementNames({ req, payload }) {
  const placement = getPlacement(req, payload.schoolUnitId, payload.campusId, payload.schoolLevel);
  if (!placement) return payload;

  return {
    ...payload,
    schoolUnitName: payload.schoolUnitName || cleanStr(placement.schoolUnit?.name, 180) || undefined,
    schoolUnitCode: payload.schoolUnitCode || cleanStr(placement.schoolUnit?.code, 40) || undefined,
    campusName: payload.campusName || cleanStr(placement.campus?.name, 180) || undefined,
    campusCode: payload.campusCode || cleanStr(placement.campus?.code, 40) || undefined,
  };
}

async function buildStudentPayload({ req, body, existing = null, Student = null }) {
  let payload = {
    regNo: cleanStr(body.regNo, 60).replace(/\s+/g, " "),
    fullName: cleanStr(body.fullName, 120),
    firstName: cleanStr(body.firstName, 60),
    middleName: cleanStr(body.middleName, 60),
    lastName: cleanStr(body.lastName, 60),
    email: normalizeEmailOptional(body.email),
    phone: cleanStr(body.phone, 40) || undefined,
    schoolUnitId: cleanStr(body.schoolUnitId, 80) || undefined,
    schoolUnitName: cleanStr(body.schoolUnitName, 180) || undefined,
    schoolUnitCode: cleanStr(body.schoolUnitCode, 40) || undefined,
    campusId: cleanStr(body.campusId, 80) || undefined,
    campusName: cleanStr(body.campusName, 180) || undefined,
    campusCode: cleanStr(body.campusCode, 40) || undefined,
    classId: cleanStr(body.classId, 80) || undefined,
    className: cleanStr(body.className, 180) || undefined,
    classCode: cleanStr(body.classCode, 40) || undefined,
    section: cleanStr(body.section, 40) || undefined,
    stream: cleanStr(body.section || body.stream, 40) || undefined,
    schoolLevel: normalizeSchoolLevel(body.schoolLevel) || "primary",
    classLevel: normalizeClassLevel(body.classLevel),
    subjects: normalizeSubjectIds(body.subjects),
    academicYear: cleanStr(body.academicYear, 20) || undefined,
    term: [1, 2, 3].includes(Number(body.term)) ? Number(body.term) : 1,
    status: normalizeStatus(body.status) || "active",
    holdType: cleanStr(body.holdType, 60) || undefined,
    holdReason: cleanStr(body.holdReason, 200) || undefined,
    gender: cleanStr(body.gender, 30) || undefined,
    nationality: cleanStr(body.nationality, 60) || undefined,
    address: cleanStr(body.address, 200) || undefined,
    guardianName: cleanStr(body.guardianName, 120) || undefined,
    guardianPhone: cleanStr(body.guardianPhone, 40) || undefined,
    guardianEmail: normalizeEmailOptional(body.guardianEmail),
  };

  payload = await enrichFromSelectedClass({ req, payload });
  payload = applyPlacementNames({ req, payload });

  if (!payload.regNo) {
    if (!Student) throw new Error("Student model is required for auto-generated regNo.");
    payload.regNo = await generateRegNo({
      req,
      Student,
      schoolLevel: payload.schoolLevel,
      classLevel: payload.classLevel,
    });
  }

  if (!payload.fullName) {
    payload.fullName = [payload.firstName, payload.middleName, payload.lastName].filter(Boolean).join(" ").trim();
  }

  if (!payload.classLevel) {
    throw new Error("Class level is required.");
  }

  if (!payload.schoolLevel) {
    throw new Error("School level is required.");
  }

  if (!payload.schoolUnitId && existing?.schoolUnitId) payload.schoolUnitId = existing.schoolUnitId;
  if (!payload.campusId && existing?.campusId) payload.campusId = existing.campusId;

  return payload;
}

const studentRules = [
  body("regNo").optional({ checkFalsy: true }).trim().isLength({ min: 2, max: 60 }).withMessage("RegNo must be 2-60 chars when provided."),
  body("fullName").optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
  body("firstName").optional({ checkFalsy: true }).trim().isLength({ max: 60 }),
  body("middleName").optional({ checkFalsy: true }).trim().isLength({ max: 60 }),
  body("lastName").optional({ checkFalsy: true }).trim().isLength({ max: 60 }),
  body("email").optional({ checkFalsy: true }).isEmail().withMessage("Invalid email.").normalizeEmail(),
  body("phone").optional({ checkFalsy: true }).trim().isLength({ max: 40 }),
  body("schoolUnitId").optional({ checkFalsy: true }).trim().isLength({ max: 80 }),
  body("campusId").optional({ checkFalsy: true }).trim().isLength({ max: 80 }),
  body("classId").optional({ checkFalsy: true }).trim().isLength({ max: 80 }),
  body("section").optional({ checkFalsy: true }).trim().isLength({ max: 40 }),

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
  LEVEL_CLASS_MAP,

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

      const studentUser = await findOrCreateStudentUser({ req, StudentDoc: student, User });
      const parentUser = await findOrCreateParentUser({ req, StudentDoc: student, User });

      let sent = 0;
      if (studentUser) sent += (await sendInviteIfPossible({ req, user: studentUser, roleLabel: "Student" })) ? 1 : 0;
      if (parentUser) sent += (await sendInviteIfPossible({ req, user: parentUser, roleLabel: "Parent" })) ? 1 : 0;

      if (!sent) {
        req.flash?.("error", "No pending setup email could be sent. Check emails or existing passwords.");
      } else {
        req.flash?.("success", `Setup link sent to ${sent} account(s).`);
      }
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

      const { Student, Subject, Class } = req.models;
      const q = cleanStr(req.query.q, 120);
      const schoolLevel = cleanStr(req.query.schoolLevel, 30).toLowerCase();
      const classLevel = normalizeClassLevel(req.query.classLevel);
      const term = cleanStr(req.query.term, 10);
      const status = cleanStr(req.query.status, 20);
      const schoolUnitId = cleanStr(req.query.schoolUnitId, 80);
      const campusId = cleanStr(req.query.campusId, 80);
      const classId = cleanStr(req.query.classId, 80);
      const section = cleanStr(req.query.section, 40);

      const page = Math.max(parseIntSafe(req.query.page, 1), 1);
      const perPage = 10;
      const filter = buildStudentFilter({ q, schoolLevel, classLevel, term, status, schoolUnitId, campusId, classId, section });

      const total = await Student.countDocuments(filter);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);
      const skip = (safePage - 1) * perPage;

      const [students, subjects, classes, kpis] = await Promise.all([
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
            "schoolUnitId",
            "schoolUnitName",
            "campusId",
            "campusName",
            "classId",
            "className",
            "classCode",
            "section",
            "stream",
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
        Class
          ? Class.find({})
              .select("_id name code schoolUnitId schoolUnitName schoolUnitCode campusId campusName campusCode levelType classLevel stream academicYear term status")
              .sort({ name: 1, code: 1 })
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
        ...(schoolUnitId ? { schoolUnitId } : {}),
        ...(campusId ? { campusId } : {}),
        ...(classId ? { classId } : {}),
        ...(section ? { section } : {}),
      }).toString();

      return res.render("tenant/students/index", {
        tenant: req.tenant || null,
        students: students.map((s) => ({
          ...s,
          id: String(s._id),
        })),
        subjects,
        classes: classes.map((c) => ({
          id: String(c._id),
          name: c.name || "",
          code: c.code || "",
          schoolUnitId: c.schoolUnitId || "",
          schoolUnitName: c.schoolUnitName || "",
          schoolUnitCode: c.schoolUnitCode || "",
          campusId: c.campusId || "",
          campusName: c.campusName || "",
          campusCode: c.campusCode || "",
          schoolLevel: String(c.levelType || "").toLowerCase(),
          classLevel: c.classLevel || "",
          section: c.stream || c.section || "",
          academicYear: c.academicYear || "",
          term: Number(c.term || 1),
          status: c.status || "active",
        })),
        structure: buildStructure(req),
        classLevels: CLASS_LEVELS,
        classLevelMap: LEVEL_CLASS_MAP,
        kpis,
        csrfToken: res.locals.csrfToken || null,
        exportQuery,
        query: { q, schoolLevel, classLevel, term, status, schoolUnitId, campusId, classId, section, page: safePage, perPage, total, totalPages },
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
      const payload = await buildStudentPayload({ req, body: req.body, Student });

      const exists = await Student.findOne({ regNo: payload.regNo, isDeleted: { $ne: true } }).lean();
      if (exists) {
        req.flash?.("error", "RegNo already exists.");
        return res.redirect("/tenant/students");
      }

      const actorId = actorObjectId(req);
      const createdStudent = await Student.create({
        ...payload,
        createdBy: actorId || undefined,
      });

      try {
        const { User } = req.models || {};
        if (!User) throw new Error("User model missing");

        const studentUser = await findOrCreateStudentUser({ req, StudentDoc: createdStudent, User });
        const parentUser = await findOrCreateParentUser({ req, StudentDoc: createdStudent, User });

        if (studentUser) {
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
        }

        if (parentUser) {
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
        }

        const sent = [
          studentUser ? await sendInviteIfPossible({ req, user: studentUser, roleLabel: "Student" }) : false,
          parentUser ? await sendInviteIfPossible({ req, user: parentUser, roleLabel: "Parent" }) : false,
        ].filter(Boolean).length;

        if (sent) req.flash?.("success", `Student created. Setup link sent to ${sent} account(s).`);
        else req.flash?.("success", "Student created.");
      } catch (e) {
        console.error("AUTO ACCOUNT/INVITE ERROR:", e);
        req.flash?.("success", "Student created.");
        req.flash?.("error", `But account setup/email failed: ${e.message}`);
      }

      return res.redirect("/tenant/students");
    } catch (err) {
      console.error("STUDENT CREATE ERROR:", err);
      req.flash?.("error", String(err?.code) === "11000" ? "RegNo already exists." : (err.message || "Failed to create student."));
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

      const existing = await Student.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
      if (!existing) {
        req.flash?.("error", "Student not found.");
        return res.redirect("/tenant/students");
      }

      const payload = await buildStudentPayload({ req, body: req.body, existing, Student });

      const collision = await Student.findOne({ regNo: payload.regNo, _id: { $ne: id }, isDeleted: { $ne: true } }).lean();
      if (collision) {
        req.flash?.("error", "RegNo already exists.");
        return res.redirect("/tenant/students");
      }

      const actorId = actorObjectId(req);

      await Student.updateOne(
        { _id: id },
        {
          $set: {
            ...payload,
            updatedBy: actorId || undefined,
          },
        },
        { runValidators: true }
      );

      req.flash?.("success", "Student updated.");
      return res.redirect("/tenant/students");
    } catch (err) {
      console.error("STUDENT UPDATE ERROR:", err);
      req.flash?.("error", String(err?.code) === "11000" ? "RegNo already exists." : (err.message || "Failed to update student."));
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
    req.flash?.("error", "CSV import was not changed in this update.");
    return res.redirect("/tenant/students");
  },
};