const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");
const { sendMail } = require("../../../utils/mailer");
const { createSetPasswordInvite } = require("../../../utils/inviteService");
const { setupPasswordEmail } = require("../../../utils/emailTemplates");
const { uploadBuffer, safeDestroy } = require("../../../utils/cloudinaryUpload");
const {
  ensureSingleRoleForUser,
  singleRoleUpdate,
} = require("../../../utils/tenantUserAccounts");
const {
  REQUIRED_STUDENT_DOC_TYPES,
  normalizeStudentDocType,
  titleForStudentDocType,
  ensureStudentDocsFromApplicants,
  buildStudentDocSummaries,
} = require("../../../utils/studentDocs");

let importedNextRegNo = null;
try {
  ({ nextRegNo: importedNextRegNo } = require("../../../utils/regNo"));
} catch (_) {}

const cleanStr = (value, max = 2000) => String(value || "").trim().slice(0, max);
const isObjId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const cleanEmail = (value) => String(value || "").trim().toLowerCase();
const normalizeEmailOptional = (value, max = 120) => {
  const email = cleanStr(value, max).toLowerCase();
  return email || undefined;
};
const parseIntSafe = (value, fallback = 1) => {
  const parsed = parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const escapeRegExp = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const toObjectId = (value) => (isObjId(value) ? new mongoose.Types.ObjectId(String(value)) : null);

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
const STUDENT_BASE_PATH = "/admin/students";

const normalizeStatus = (value) => {
  const status = String(value || "").trim().toLowerCase();
  return new Set(["active", "on_hold", "suspended", "graduated", "archived"]).has(status) ? status : null;
};

const actorObjectId = (req) => {
  const raw = req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;
  return raw && isObjId(raw) ? new mongoose.Types.ObjectId(String(raw)) : null;
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
  for (const [key, value] of Object.entries(patch || {})) {
    if (modelHasPath(StudentModel, key)) $set[key] = value;
  }
  if (!Object.keys($set).length) return;
  await StudentModel.updateOne({ _id: studentId }, { $set }).catch(() => {});
}

function normalizeClassLevel(value) {
  const classLevel = String(value || "").trim().toUpperCase();
  return CLASS_LEVELS.includes(classLevel) ? classLevel : "";
}

function normalizeSchoolLevel(value) {
  const level = String(value || "").trim().toLowerCase();
  return SCHOOL_LEVELS.includes(level) ? level : "";
}

function normalizeSubjectIds(value) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items
    .map((item) => String(item || "").trim())
    .filter((item) => isObjId(item))
    .map((item) => new mongoose.Types.ObjectId(item));
}

function asDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pickFirst(files, key) {
  const group = files?.[key];
  if (!Array.isArray(group) || !group.length) return null;
  return group[0] || null;
}

function pickMany(files, key) {
  const group = files?.[key];
  return Array.isArray(group) ? group : [];
}

function getSchoolLevels() {
  return [
    { value: "nursery", label: "Nursery" },
    { value: "primary", label: "Primary" },
    { value: "secondary", label: "Secondary" },
  ];
}

function getQualificationOptions(level) {
  const key = normalizeSchoolLevel(level);
  if (key === "nursery") return ["No previous education"];
  if (key === "primary") return ["Nursery", "No previous education"];
  return ["P7", "P8", "UCE", "UACE", "Certificate", "Diploma"];
}

function buildQualificationMap() {
  return {
    nursery: getQualificationOptions("nursery"),
    primary: getQualificationOptions("primary"),
    secondary: getQualificationOptions("secondary"),
  };
}

function qualificationHasNoPreviousEducation(value) {
  return cleanStr(value, 60).toLowerCase() === "no previous education";
}

function buildAcademicYears(terms) {
  const years = new Set();
  (terms || []).forEach((term) => {
    const year = cleanStr(term?.year, 20);
    if (year) years.add(year);
  });
  return Array.from(years).sort();
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
    const schoolUnitRef = String(schoolUnit.id || schoolUnit._id || "");
    if (schoolUnitId && schoolUnitRef !== String(schoolUnitId)) continue;

    for (const campus of schoolUnit.campuses || []) {
      const campusRef = String(campus.id || campus._id || "");
      if (campusId && campusRef !== String(campusId)) continue;

      const level = (campus.levels || []).find(
        (entry) => String(entry.type || "").toLowerCase() === String(schoolLevel || "").toLowerCase()
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

async function loadAdmissionsPlacementData(req) {
  const { Intake, Stream, Section } = req.models || {};

  const [terms, streams, sections] = await Promise.all([
    Intake
      ? Intake.find({
          isDeleted: { $ne: true },
          status: { $in: ["draft", "open", "closed"] },
        })
          .select("_id name year term code status isActive")
          .sort({ isActive: -1, year: -1, createdAt: -1 })
          .lean()
      : [],
    Stream
      ? Stream.find({ status: { $ne: "archived" } })
          .select("_id name levelType classLevel classId className classCode classStream campusId campusName campusCode schoolUnitId schoolUnitName schoolUnitCode")
          .sort({ levelType: 1, classLevel: 1, name: 1 })
          .lean()
      : [],
    Section
      ? Section.find({ status: { $ne: "archived" } })
          .select("_id name levelType classLevel classId className classCode classStream campusId campusName campusCode schoolUnitId schoolUnitName schoolUnitCode")
          .sort({ levelType: 1, classLevel: 1, classStream: 1, name: 1 })
          .lean()
      : [],
  ]);

  return {
    terms: terms.map((term) => ({
      _id: String(term._id),
      name: cleanStr(term.name, 120),
      year: cleanStr(term.year, 20),
      term: cleanStr(term.term, 20),
      code: cleanStr(term.code, 40),
      status: cleanStr(term.status, 20),
      isActive: !!term.isActive,
    })),
    streams: streams.map((stream) => ({
      _id: String(stream._id),
      name: cleanStr(stream.name, 120),
      levelType: normalizeSchoolLevel(stream.levelType),
      classLevel: normalizeClassLevel(stream.classLevel),
      classId: cleanStr(stream.classId, 80),
      className: cleanStr(stream.className, 180),
      classCode: cleanStr(stream.classCode, 40),
      classStream: cleanStr(stream.classStream, 80),
      campusId: cleanStr(stream.campusId, 80),
      campusName: cleanStr(stream.campusName, 180),
      campusCode: cleanStr(stream.campusCode, 40),
      schoolUnitId: cleanStr(stream.schoolUnitId, 80),
      schoolUnitName: cleanStr(stream.schoolUnitName, 180),
      schoolUnitCode: cleanStr(stream.schoolUnitCode, 40),
    })),
    sections: sections.map((section) => ({
      _id: String(section._id),
      name: cleanStr(section.name, 120),
      levelType: normalizeSchoolLevel(section.levelType),
      classLevel: normalizeClassLevel(section.classLevel),
      classId: cleanStr(section.classId, 80),
      className: cleanStr(section.className, 180),
      classCode: cleanStr(section.classCode, 40),
      classStream: cleanStr(section.classStream, 80),
      campusId: cleanStr(section.campusId, 80),
      campusName: cleanStr(section.campusName, 180),
      campusCode: cleanStr(section.campusCode, 40),
      schoolUnitId: cleanStr(section.schoolUnitId, 80),
      schoolUnitName: cleanStr(section.schoolUnitName, 180),
      schoolUnitCode: cleanStr(section.schoolUnitCode, 40),
    })),
  };
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
  if (section) filter.$or = [{ section }, { stream: section }];

  return filter;
}

async function kpiAgg(Student, match) {
  const rows = await Student.aggregate([
    { $match: match },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  const mapped = Object.fromEntries(rows.map((row) => [row._id, row.count]));
  const total = Object.values(mapped).reduce((sum, count) => sum + count, 0);

  return {
    total,
    active: mapped.active || 0,
    on_hold: mapped.on_hold || 0,
    suspended: mapped.suspended || 0,
    graduated: mapped.graduated || 0,
    archived: mapped.archived || 0,
  };
}

function fallbackRegNo(existingValues = [], year = new Date().getFullYear()) {
  let max = 0;
  for (const raw of existingValues) {
    const value = String(raw || "");
    const match = value.match(/(\d+)(?!.*\d)/);
    if (!match) continue;
    max = Math.max(max, Number(match[1] || 0));
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

  const existing = await Student.find({ isDeleted: { $ne: true } })
    .select("regNo createdAt")
    .sort({ createdAt: -1 })
    .lean();
  return fallbackRegNo(existing.map((row) => row.regNo));
}

async function findOrCreateStudentUser({ req, StudentDoc, User }) {
  const email = cleanEmail(StudentDoc?.email);
  const fullName = cleanStr(StudentDoc?.fullName, 120);
  const firstName = cleanStr(StudentDoc?.firstName, 60) || fullName.split(" ")[0] || "Student";
  const lastName = cleanStr(StudentDoc?.lastName, 60) || fullName.split(" ").slice(1).join(" ") || "Account";

  if (StudentDoc?.userId && isObjId(StudentDoc.userId)) {
    const existing = await User.findOne({ _id: StudentDoc.userId, deletedAt: null }).select("+passwordHash roles status tokenVersion email firstName lastName studentId");
    if (existing) return ensureSingleRoleForUser(existing, "student", email);
  }

  if (email) {
    const existing = await User.findOne({ email, deletedAt: null }).select("+passwordHash roles status tokenVersion email firstName lastName studentId");
    if (existing) return ensureSingleRoleForUser(existing, "student", email);
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
    const existing = await User.findOne({ _id: StudentDoc.guardianUserId, deletedAt: null }).select("+passwordHash roles status tokenVersion email firstName lastName childrenStudentIds");
    if (existing) return ensureSingleRoleForUser(existing, "parent", guardianEmail);
  }

  if (guardianEmail) {
    const existing = await User.findOne({ email: guardianEmail, deletedAt: null }).select("+passwordHash roles status tokenVersion email firstName lastName childrenStudentIds");
    if (existing) return ensureSingleRoleForUser(existing, "parent", guardianEmail);
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

  let parent = await Parent.findOne({ userId: parentUser._id }).catch(() => null);
  if (!parent) parent = await Parent.findOne({ email }).catch(() => null);

  if (!parent) {
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

  const children = new Set((parent.childrenStudentIds || []).map(String));
  children.add(String(studentId));

  await Parent.updateOne(
    { _id: parent._id },
    {
      $set: {
        userId: parent.userId || parentUser._id,
        firstName: parent.firstName || firstName,
        lastName: parent.lastName || lastName,
        phone: parent.phone || parentUser.phone || StudentDoc?.guardianPhone || "",
        childrenStudentIds: Array.from(children),
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

function extractStudentDocState(summary) {
  return {
    passportPhoto: summary?.docState?.passportPhoto || null,
    idDocument: summary?.docState?.idDocument || null,
    transcript: summary?.docState?.transcript || null,
    otherDocs: Array.isArray(summary?.docState?.otherDocs) ? summary.docState.otherDocs : [],
  };
}

async function getExistingRequiredDocTypes({ req, studentId }) {
  const { StudentDoc, Applicant } = req.models || {};
  if (!StudentDoc || !studentId) return new Set();

  await ensureStudentDocsFromApplicants({
    StudentDoc,
    Applicant,
    studentIds: [studentId],
    uploadedBy: req.user?._id || null,
  }).catch((err) => {
    console.error("STUDENT DOC PRECHECK ERROR:", err);
  });

  const rows = await StudentDoc.find({
    student: studentId,
    isDeleted: { $ne: true },
  })
    .select("type title")
    .lean();

  return new Set(rows.map((row) => normalizeStudentDocType(row.type, row.title)));
}

async function buildStudentFormErrors({ req, body, files, placement, existingStudent = null }) {
  const errors = {};
  const required = (key, message) => {
    if (!body?.[key] || !String(body[key]).trim()) errors[key] = message;
  };

  required("firstName", "First name is required.");
  required("lastName", "Last name is required.");
  required("gender", "Gender is required.");
  required("dob", "Date of birth is required.");
  required("nationality", "Nationality is required.");
  required("address", "Address is required.");
  required("phone", "Phone is required.");
  required("email", "Email is required.");
  required("termId", "Term is required.");
  required("academicYear", "Academic year is required.");
  required("schoolLevel", "School level is required.");
  required("classLevel", "Class level is required.");
  required("streamId", "Stream is required.");
  required("section1", "Section is required.");
  required("guardianName", "Guardian name is required.");
  required("guardianPhone", "Guardian phone is required.");
  required("qualification", "Highest qualification is required.");

  const dob = asDate(body?.dob);
  if (!dob) errors.dob = "Provide a valid date of birth.";

  const schoolLevel = normalizeSchoolLevel(body?.schoolLevel);
  if (!schoolLevel) errors.schoolLevel = "Select a valid school level.";

  const classLevel = normalizeClassLevel(body?.classLevel);
  if (!classLevel) errors.classLevel = "Select a valid class level.";

  const termId = cleanStr(body?.termId, 80);
  const streamId = cleanStr(body?.streamId, 80);
  const sectionId = cleanStr(body?.section1, 80);

  const termDoc = (placement.terms || []).find((term) => String(term._id) === termId) || null;
  const streamDoc = (placement.streams || []).find((stream) => String(stream._id) === streamId) || null;
  const sectionDoc = (placement.sections || []).find((section) => String(section._id) === sectionId) || null;

  if (!termDoc) errors.termId = "Select a valid term.";
  if (termDoc && cleanStr(body?.academicYear, 20) && cleanStr(termDoc.year, 20) !== cleanStr(body?.academicYear, 20)) {
    errors.academicYear = "Academic year must match the selected term.";
  }

  if (!streamDoc) errors.streamId = "Select a valid stream.";
  if (!sectionDoc) errors.section1 = "Select a valid section.";

  if (streamDoc) {
    if (streamDoc.levelType && streamDoc.levelType !== schoolLevel) {
      errors.streamId = "Stream does not match the selected school level.";
    }
    if (streamDoc.classLevel && streamDoc.classLevel !== classLevel) {
      errors.streamId = "Stream does not match the selected class level.";
    }
  }

  if (sectionDoc) {
    if (sectionDoc.levelType && sectionDoc.levelType !== schoolLevel) {
      errors.section1 = "Section does not match the selected school level.";
    }
    if (sectionDoc.classLevel && sectionDoc.classLevel !== classLevel) {
      errors.section1 = "Section does not match the selected class level.";
    }
    if (streamDoc && sectionDoc.classId && streamDoc.classId && sectionDoc.classId !== streamDoc.classId) {
      errors.section1 = "Section does not belong to the selected stream/class.";
    }
  }

  const qualification = cleanStr(body?.qualification, 60);
  const noPreviousEducation = qualificationHasNoPreviousEducation(qualification);
  if (!noPreviousEducation) {
    required("school", "School / institution is required.");
    required("yearCompleted", "Year completed is required.");
    const yearCompletedRaw = cleanStr(body?.yearCompleted, 10);
    const yearCompleted = Number(yearCompletedRaw);
    const currentYear = new Date().getFullYear();
    if (yearCompletedRaw && (Number.isNaN(yearCompleted) || yearCompleted < 1900 || yearCompleted > currentYear + 1)) {
      errors.yearCompleted = "Year completed is invalid.";
    }
  }

  const existingDocTypes = existingStudent?._id
    ? await getExistingRequiredDocTypes({ req, studentId: existingStudent._id })
    : new Set();

  if (!pickFirst(files, "passportPhoto") && !existingDocTypes.has("passport")) {
    errors.passportPhoto = "Passport photo is required.";
  }
  if (!pickFirst(files, "idDocument") && !existingDocTypes.has("id")) {
    errors.idDocument = "National ID / Passport scan is required.";
  }
  if (!noPreviousEducation && !pickFirst(files, "transcript") && !existingDocTypes.has("transcript")) {
    errors.transcript = "Transcript / Results Slip is required.";
  }

  return errors;
}

async function buildStudentPayload({ req, body, existing = null, Student = null, placement }) {
  const { Class } = req.models || {};

  const termId = cleanStr(body.termId, 80);
  const streamId = cleanStr(body.streamId, 80);
  const sectionId = cleanStr(body.section1, 80);

  const termDoc = (placement?.terms || []).find((term) => String(term._id) === termId) || null;
  const streamDoc = (placement?.streams || []).find((stream) => String(stream._id) === streamId) || null;
  const sectionDoc = (placement?.sections || []).find((section) => String(section._id) === sectionId) || null;

  const linkedClassId = cleanStr(sectionDoc?.classId || streamDoc?.classId || existing?.classId, 80);
  const classDoc = Class && isObjId(linkedClassId)
    ? await Class.findOne({ _id: linkedClassId }).select("name code schoolUnitId schoolUnitName schoolUnitCode campusId campusName campusCode levelType classLevel stream academicYear term").lean().catch(() => null)
    : null;

  const schoolLevel = normalizeSchoolLevel(body.schoolLevel || sectionDoc?.levelType || streamDoc?.levelType || classDoc?.levelType || existing?.schoolLevel) || "primary";
  const classLevel = normalizeClassLevel(body.classLevel || sectionDoc?.classLevel || streamDoc?.classLevel || classDoc?.classLevel || existing?.classLevel);
  const noPreviousEducation = qualificationHasNoPreviousEducation(body.qualification);

  let payload = {
    regNo: cleanStr(body.regNo, 60).replace(/\s+/g, " "),
    fullName: cleanStr(body.fullName, 120),
    firstName: cleanStr(body.firstName, 60),
    middleName: cleanStr(body.middleName, 60),
    lastName: cleanStr(body.lastName, 60),
    email: normalizeEmailOptional(body.email),
    phone: cleanStr(body.phone, 40) || undefined,
    schoolUnitId: cleanStr(classDoc?.schoolUnitId || sectionDoc?.schoolUnitId || streamDoc?.schoolUnitId || existing?.schoolUnitId, 80) || undefined,
    schoolUnitName: cleanStr(classDoc?.schoolUnitName || sectionDoc?.schoolUnitName || streamDoc?.schoolUnitName || existing?.schoolUnitName, 180) || undefined,
    schoolUnitCode: cleanStr(classDoc?.schoolUnitCode || sectionDoc?.schoolUnitCode || streamDoc?.schoolUnitCode || existing?.schoolUnitCode, 40) || undefined,
    campusId: cleanStr(classDoc?.campusId || sectionDoc?.campusId || streamDoc?.campusId || existing?.campusId, 80) || undefined,
    campusName: cleanStr(classDoc?.campusName || sectionDoc?.campusName || streamDoc?.campusName || existing?.campusName, 180) || undefined,
    campusCode: cleanStr(classDoc?.campusCode || sectionDoc?.campusCode || streamDoc?.campusCode || existing?.campusCode, 40) || undefined,
    classId: cleanStr(classDoc?._id || linkedClassId || existing?.classId, 80) || undefined,
    className: cleanStr(classDoc?.name || sectionDoc?.className || streamDoc?.className || existing?.className, 180) || undefined,
    classCode: cleanStr(classDoc?.code || sectionDoc?.classCode || streamDoc?.classCode || existing?.classCode, 40) || undefined,
    intakeId: cleanStr(termDoc?._id || existing?.intakeId, 80) || undefined,
    streamId: cleanStr(streamDoc?._id || existing?.streamId, 80) || undefined,
    sectionId: cleanStr(sectionDoc?._id || existing?.sectionId, 80) || undefined,
    section: cleanStr(sectionDoc?.name || existing?.section, 40) || undefined,
    stream: cleanStr(streamDoc?.name || streamDoc?.classStream || sectionDoc?.classStream || existing?.stream, 40) || undefined,
    schoolLevel,
    classLevel,
    subjects: normalizeSubjectIds(body.subjects),
    academicYear: cleanStr(termDoc?.year || classDoc?.academicYear || body.academicYear || existing?.academicYear, 20) || undefined,
    term: (() => {
      const termValue = cleanStr(termDoc?.term || classDoc?.term || existing?.term || 1, 20);
      const parsed = parseIntSafe(termValue, 1);
      return [1, 2, 3].includes(parsed) ? parsed : 1;
    })(),
    status: normalizeStatus(body.status) || "active",
    holdType: cleanStr(body.holdType, 60) || undefined,
    holdReason: cleanStr(body.holdReason, 200) || undefined,
    gender: cleanStr(body.gender, 30) || undefined,
    dob: asDate(body.dob),
    nationality: cleanStr(body.nationality, 60) || undefined,
    address: cleanStr(body.address, 200) || undefined,
    guardianName: cleanStr(body.guardianName, 120) || undefined,
    guardianPhone: cleanStr(body.guardianPhone, 40) || undefined,
    guardianEmail: normalizeEmailOptional(body.guardianEmail),
    qualification: cleanStr(body.qualification, 60) || undefined,
    school: noPreviousEducation ? "" : (cleanStr(body.school, 120) || undefined),
    yearCompleted: noPreviousEducation ? null : (cleanStr(body.yearCompleted, 10) ? Number(body.yearCompleted) : null),
    grades: cleanStr(body.grades, 160) || undefined,
    notes: cleanStr(body.notes, 600) || undefined,
  };

  const placementInfo = getPlacement(req, payload.schoolUnitId, payload.campusId, payload.schoolLevel);
  if (placementInfo) {
    payload.schoolUnitName = payload.schoolUnitName || cleanStr(placementInfo.schoolUnit?.name, 180) || undefined;
    payload.schoolUnitCode = payload.schoolUnitCode || cleanStr(placementInfo.schoolUnit?.code, 40) || undefined;
    payload.campusName = payload.campusName || cleanStr(placementInfo.campus?.name, 180) || undefined;
    payload.campusCode = payload.campusCode || cleanStr(placementInfo.campus?.code, 40) || undefined;
  }

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

  if (!payload.classLevel) throw new Error("Class level is required.");
  if (!payload.schoolLevel) throw new Error("School level is required.");

  return payload;
}

async function syncStudentDocsFromUploads({ req, studentId }) {
  const { StudentDoc } = req.models || {};
  if (!StudentDoc || !studentId) return { photoUrl: null };

  const folder = `classic-academy/${req.tenant?.slug || req.tenant?.code || "tenant"}/student-docs`;
  const actorId = actorObjectId(req) || req.user?._id || null;

  const passportFile = pickFirst(req.files, "passportPhoto");
  const idFile = pickFirst(req.files, "idDocument");
  const transcriptFile = pickFirst(req.files, "transcript");
  const otherFiles = pickMany(req.files, "otherDocs");

  const existingRequiredRows = await StudentDoc.find({
    student: studentId,
    isDeleted: { $ne: true },
  }).sort({ createdAt: -1 });

  const latestByType = new Map();
  for (const row of existingRequiredRows) {
    const type = normalizeStudentDocType(row.type, row.title);
    if (!latestByType.has(type)) latestByType.set(type, row);
  }

  const buildDocPayload = (file, upload, type) => ({
    url: upload.secure_url,
    publicId: upload.public_id,
    resourceType: upload.resource_type || (type === "passport" ? "image" : "auto"),
    originalName: file.originalname || "",
    bytes: file.size || upload.bytes || 0,
    mimeType: file.mimetype || "",
    source: "admin_upload",
    sharedAsset: false,
    uploadedAt: new Date(),
  });

  const upsertRequiredDoc = async (type, file) => {
    if (!file) return null;

    const upload = await uploadBuffer(file, folder, {
      resource_type: type === "passport" ? "image" : "auto",
    });
    const docPayload = buildDocPayload(file, upload, type);
    const title = titleForStudentDocType(type);
    const existing = latestByType.get(type) || null;

    if (existing) {
      if (existing.doc?.publicId && !existing.doc?.sharedAsset) {
        await safeDestroy(existing.doc.publicId, existing.doc.resourceType || "auto").catch(() => {});
      }
      existing.type = type;
      existing.title = title;
      existing.doc = docPayload;
      existing.updatedBy = actorId || null;
      await existing.save();
      latestByType.set(type, existing);
      return existing.toObject ? existing.toObject() : existing;
    }

    const created = await StudentDoc.create({
      student: studentId,
      type,
      title,
      doc: docPayload,
      uploadedBy: actorId || null,
      updatedBy: actorId || null,
    });
    latestByType.set(type, created);
    return created.toObject ? created.toObject() : created;
  };

  const uploads = {};
  const passportDoc = await upsertRequiredDoc("passport", passportFile);
  if (passportDoc?.doc?.url) uploads.photoUrl = passportDoc.doc.url;

  await upsertRequiredDoc("id", idFile);
  await upsertRequiredDoc("transcript", transcriptFile);

  for (const file of otherFiles) {
    const upload = await uploadBuffer(file, folder, { resource_type: "auto" });
    await StudentDoc.create({
      student: studentId,
      type: "other",
      title: cleanStr(file.originalname, 180) || titleForStudentDocType("other"),
      doc: buildDocPayload(file, upload, "other"),
      uploadedBy: actorId || null,
      updatedBy: actorId || null,
    });
  }

  return uploads;
}

const studentRules = [
  body("regNo").optional({ checkFalsy: true }).trim().isLength({ min: 0, max: 60 }),
  body("fullName").optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
  body("firstName").trim().isLength({ min: 1, max: 60 }).withMessage("First name is required."),
  body("middleName").optional({ checkFalsy: true }).trim().isLength({ max: 60 }),
  body("lastName").trim().isLength({ min: 1, max: 60 }).withMessage("Last name is required."),
  body("email").isEmail().withMessage("Valid student email is required.").normalizeEmail(),
  body("phone").trim().isLength({ min: 1, max: 40 }).withMessage("Phone is required."),
  body("schoolLevel").trim().custom((value) => !!normalizeSchoolLevel(value)).withMessage("Invalid school level."),
  body("classLevel").trim().custom((value) => !!normalizeClassLevel(value)).withMessage("Invalid class level."),
  body("termId").trim().isLength({ min: 1, max: 80 }).withMessage("Term is required."),
  body("academicYear").trim().isLength({ min: 1, max: 20 }).withMessage("Academic year is required."),
  body("streamId").trim().isLength({ min: 1, max: 80 }).withMessage("Stream is required."),
  body("section1").trim().isLength({ min: 1, max: 80 }).withMessage("Section is required."),
  body("qualification").trim().isLength({ min: 1, max: 60 }).withMessage("Highest qualification is required."),
  body("school").optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
  body("yearCompleted").optional({ checkFalsy: true }).isInt({ min: 1900, max: 2100 }).toInt(),
  body("grades").optional({ checkFalsy: true }).trim().isLength({ max: 160 }),
  body("gender").trim().isLength({ min: 1, max: 30 }).withMessage("Gender is required."),
  body("dob").trim().isISO8601().withMessage("Valid date of birth is required.").toDate(),
  body("nationality").trim().isLength({ min: 1, max: 60 }).withMessage("Nationality is required."),
  body("address").trim().isLength({ min: 1, max: 200 }).withMessage("Address is required."),
  body("guardianName").trim().isLength({ min: 1, max: 120 }).withMessage("Guardian name is required."),
  body("guardianPhone").trim().isLength({ min: 1, max: 40 }).withMessage("Guardian phone is required."),
  body("guardianEmail").optional({ checkFalsy: true }).isEmail().withMessage("Invalid guardian email.").normalizeEmail(),
  body("notes").optional({ checkFalsy: true }).trim().isLength({ max: 600 }),
  body("status").optional({ checkFalsy: true }).custom((value) => !!normalizeStatus(value)).withMessage("Invalid status."),
  body("holdType").optional({ checkFalsy: true }).trim().isLength({ max: 60 }),
  body("holdReason").optional({ checkFalsy: true }).trim().isLength({ max: 200 }),
  body("subjects")
    .optional()
    .custom((value) => {
      const items = Array.isArray(value) ? value : value ? [value] : [];
      return items.every((item) => isObjId(item));
    })
    .withMessage("Invalid subject selection."),
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

      const { Student, Subject, Class, StudentDoc, Applicant } = req.models;
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

      const [students, subjects, classes, kpis, placement] = await Promise.all([
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
            "intakeId",
            "streamId",
            "sectionId",
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
            "dob",
            "nationality",
            "address",
            "guardianName",
            "guardianPhone",
            "guardianEmail",
            "qualification",
            "school",
            "yearCompleted",
            "grades",
            "notes",
            "photoUrl",
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
        loadAdmissionsPlacementData(req),
      ]);

      const displayedStudentIds = students.map((student) => student._id);
      if (displayedStudentIds.length && StudentDoc) {
        await ensureStudentDocsFromApplicants({
          StudentDoc,
          Applicant,
          studentIds: displayedStudentIds,
          uploadedBy: req.user?._id || null,
        }).catch((err) => {
          console.error("STUDENT DOC BACKFILL ERROR:", err);
        });
      }

      const studentDocRows = displayedStudentIds.length && StudentDoc
        ? await StudentDoc.find({
            student: { $in: displayedStudentIds },
            isDeleted: { $ne: true },
          })
            .select("_id student type title doc createdAt updatedAt")
            .sort({ createdAt: -1 })
            .lean()
        : [];

      const studentDocSummaries = buildStudentDocSummaries(students, studentDocRows);
      const docSummaryMap = new Map(studentDocSummaries.map((summary) => [summary.id, summary]));

      return res.render("tenant/students/index", {
        tenant: req.tenant || null,
        students: students.map((student) => {
          const id = String(student._id);
          const docSummary = docSummaryMap.get(id) || null;
          return {
            ...student,
            id,
            documents: extractStudentDocState(docSummary),
          };
        }),
        subjects,
        classes: classes.map((row) => ({
          id: String(row._id),
          name: row.name || "",
          code: row.code || "",
          schoolUnitId: row.schoolUnitId || "",
          schoolUnitName: row.schoolUnitName || "",
          schoolUnitCode: row.schoolUnitCode || "",
          campusId: row.campusId || "",
          campusName: row.campusName || "",
          campusCode: row.campusCode || "",
          schoolLevel: String(row.levelType || "").toLowerCase(),
          classLevel: row.classLevel || "",
          section: row.stream || row.section || "",
          academicYear: row.academicYear || "",
          term: Number(row.term || 1),
          status: row.status || "active",
        })),
        structure: buildStructure(req),
        classLevels: CLASS_LEVELS,
        classLevelMap: LEVEL_CLASS_MAP,
        schoolLevels: getSchoolLevels(),
        qualificationMap: buildQualificationMap(),
        terms: placement.terms,
        streams: placement.streams,
        sections: placement.sections,
        academicYears: buildAcademicYears(placement.terms),
        studentDocSummaries,
        kpis,
        csrfToken: typeof req.csrfToken === "function" ? req.csrfToken() : res.locals.csrfToken || null,
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
      req.flash?.("error", errors.array().map((entry) => entry.msg).join(" "));
      return res.redirect(STUDENT_BASE_PATH);
    }

    try {
      const placement = await loadAdmissionsPlacementData(req);
      const formErrors = await buildStudentFormErrors({
        req,
        body: req.body,
        files: req.files,
        placement,
      });
      if (Object.keys(formErrors).length) {
        req.flash?.("error", Object.values(formErrors).join(" "));
        return res.redirect(STUDENT_BASE_PATH);
      }

      const payload = await buildStudentPayload({ req, body: req.body, Student, placement });
      const exists = await Student.findOne({ regNo: payload.regNo, isDeleted: { $ne: true } }).lean();
      if (exists) {
        req.flash?.("error", "RegNo already exists.");
        return res.redirect(STUDENT_BASE_PATH);
      }

      const actorId = actorObjectId(req);
      const createdStudent = await Student.create({
        ...payload,
        createdBy: actorId || undefined,
      });

      try {
        const uploads = await syncStudentDocsFromUploads({ req, studentId: createdStudent._id });
        if (uploads.photoUrl) {
          await Student.updateOne({ _id: createdStudent._id }, { $set: { photoUrl: uploads.photoUrl } });
          createdStudent.photoUrl = uploads.photoUrl;
        }
      } catch (err) {
        console.error("STUDENT DOC UPLOAD ERROR:", err);
        req.flash?.("error", `Student created, but document upload failed: ${err.message}`);
      }

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
                ...singleRoleUpdate("student"),
                status: studentUser.passwordHash ? studentUser.status : "invited",
                studentId: studentUser.studentId || createdStudent._id,
              },
            }
          );
        }

        if (parentUser) {
          const children = new Set((parentUser.childrenStudentIds || []).map(String));
          children.add(String(createdStudent._id));

          await User.updateOne(
            { _id: parentUser._id, deletedAt: null },
            {
              $set: {
                ...singleRoleUpdate("parent"),
                status: parentUser.passwordHash ? parentUser.status : "invited",
                childrenStudentIds: Array.from(children),
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
      } catch (err) {
        console.error("AUTO ACCOUNT/INVITE ERROR:", err);
        req.flash?.("success", "Student created.");
        req.flash?.("error", `But account setup/email failed: ${err.message}`);
      }

      return res.redirect(STUDENT_BASE_PATH);
    } catch (err) {
      console.error("STUDENT CREATE ERROR:", err);
      req.flash?.("error", String(err?.code) === "11000" ? "RegNo already exists." : (err.message || "Failed to create student."));
      return res.redirect(STUDENT_BASE_PATH);
    }
  },

  update: async (req, res) => {
    if (!req.models?.Student) return res.status(500).send("Tenant models missing");

    const { Student } = req.models;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((entry) => entry.msg).join(" "));
      return res.redirect(STUDENT_BASE_PATH);
    }

    try {
      const id = cleanStr(req.params.id, 80);
      if (!isObjId(id)) {
        req.flash?.("error", "Invalid student id.");
        return res.redirect(STUDENT_BASE_PATH);
      }

      const existing = await Student.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
      if (!existing) {
        req.flash?.("error", "Student not found.");
        return res.redirect(STUDENT_BASE_PATH);
      }

      const placement = await loadAdmissionsPlacementData(req);
      const formErrors = await buildStudentFormErrors({
        req,
        body: req.body,
        files: req.files,
        placement,
        existingStudent: existing,
      });
      if (Object.keys(formErrors).length) {
        req.flash?.("error", Object.values(formErrors).join(" "));
        return res.redirect(STUDENT_BASE_PATH);
      }

      const payload = await buildStudentPayload({ req, body: req.body, existing, Student, placement });
      const collision = await Student.findOne({ regNo: payload.regNo, _id: { $ne: id }, isDeleted: { $ne: true } }).lean();
      if (collision) {
        req.flash?.("error", "RegNo already exists.");
        return res.redirect(STUDENT_BASE_PATH);
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

      try {
        const uploads = await syncStudentDocsFromUploads({ req, studentId: id });
        if (uploads.photoUrl) {
          await Student.updateOne({ _id: id }, { $set: { photoUrl: uploads.photoUrl } });
        }
      } catch (err) {
        console.error("STUDENT DOC UPDATE ERROR:", err);
        req.flash?.("error", `Student updated, but document upload failed: ${err.message}`);
      }

      req.flash?.("success", "Student updated.");
      return res.redirect(STUDENT_BASE_PATH);
    } catch (err) {
      console.error("STUDENT UPDATE ERROR:", err);
      req.flash?.("error", String(err?.code) === "11000" ? "RegNo already exists." : (err.message || "Failed to update student."));
      return res.redirect(STUDENT_BASE_PATH);
    }
  },

  archive: async (req, res) => {
    try {
      const { Student } = req.models;
      const id = cleanStr(req.params.id, 80);
      if (!isObjId(id)) {
        req.flash?.("error", "Invalid student id.");
        return res.redirect(STUDENT_BASE_PATH);
      }

      await Student.updateOne({ _id: id }, { $set: { status: "archived" } });
      req.flash?.("success", "Student archived.");
      return res.redirect(STUDENT_BASE_PATH);
    } catch (err) {
      console.error("STUDENT ARCHIVE ERROR:", err);
      req.flash?.("error", "Failed to archive student.");
      return res.redirect(STUDENT_BASE_PATH);
    }
  },

  remove: async (req, res) => {
    try {
      const { Student } = req.models;
      const id = cleanStr(req.params.id, 80);
      if (!isObjId(id)) {
        req.flash?.("error", "Invalid student id.");
        return res.redirect(STUDENT_BASE_PATH);
      }

      await Student.updateOne(
        { _id: id },
        { $set: { isDeleted: true, deletedAt: new Date(), status: "archived" } }
      );

      req.flash?.("success", "Student deleted (soft).");
      return res.redirect(STUDENT_BASE_PATH);
    } catch (err) {
      console.error("STUDENT DELETE ERROR:", err);
      req.flash?.("error", "Failed to delete student.");
      return res.redirect(STUDENT_BASE_PATH);
    }
  },

  bulk: async (req, res) => {
    try {
      const { Student } = req.models;
      const action = cleanStr(req.body.action, 40).toLowerCase();
      const ids = String(req.body.ids || "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => isObjId(value));

      if (!ids.length) {
        req.flash?.("error", "No students selected.");
        return res.redirect(STUDENT_BASE_PATH);
      }

      if (action === "set_status") {
        const status = normalizeStatus(req.body.status);
        if (!status) {
          req.flash?.("error", "Choose a valid status.");
          return res.redirect(STUDENT_BASE_PATH);
        }
        await Student.updateMany({ _id: { $in: ids } }, { $set: { status } });
        req.flash?.("success", `Updated status for ${ids.length} student(s).`);
        return res.redirect(STUDENT_BASE_PATH);
      }

      if (action === "set_hold") {
        const holdType = cleanStr(req.body.holdType, 60);
        const holdReason = cleanStr(req.body.holdReason, 200);
        if (!holdType) {
          req.flash?.("error", "Hold type is required.");
          return res.redirect(STUDENT_BASE_PATH);
        }
        await Student.updateMany(
          { _id: { $in: ids } },
          { $set: { status: "on_hold", holdType, holdReason } }
        );
        req.flash?.("success", `Hold applied to ${ids.length} student(s).`);
        return res.redirect(STUDENT_BASE_PATH);
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
        return res.redirect(STUDENT_BASE_PATH);
      }

      if (action === "archive") {
        await Student.updateMany({ _id: { $in: ids } }, { $set: { status: "archived" } });
        req.flash?.("success", `Archived ${ids.length} student(s).`);
        return res.redirect(STUDENT_BASE_PATH);
      }

      if (action === "delete") {
        await Student.updateMany(
          { _id: { $in: ids } },
          { $set: { isDeleted: true, deletedAt: new Date(), status: "archived" } }
        );
        req.flash?.("success", `Deleted (soft) ${ids.length} student(s).`);
        return res.redirect(STUDENT_BASE_PATH);
      }

      req.flash?.("error", "Invalid bulk action.");
      return res.redirect(STUDENT_BASE_PATH);
    } catch (err) {
      console.error("STUDENT BULK ERROR:", err);
      req.flash?.("error", "Bulk action failed.");
      return res.redirect(STUDENT_BASE_PATH);
    }
  },

  importCsv: async (req, res) => {
    req.flash?.("error", "CSV import was not changed in this update.");
    return res.redirect(STUDENT_BASE_PATH);
  },
};
