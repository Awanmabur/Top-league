const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");
const {
  loadAcademicScopeLists,
  resolveAcademicScope,
  buildAcademicScopeFilter,
} = require("../../../utils/tenantAcademicScope");

const cleanStr = (v, max = 2000) => String(v || "").trim().slice(0, max);
const isObjId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const escapeRegex = (input) => String(input || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseDateTime = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  const fixed = s.includes("T") ? s : s.replace(" ", "T");
  const d = new Date(fixed);
  return Number.isNaN(d.getTime()) ? null : d;
};

const normalizeStatus = (v) => {
  const s = String(v || "").trim().toLowerCase();
  const map = {
    present: "present",
    p: "present",
    attended: "present",
    absent: "absent",
    a: "absent",
    late: "late",
    l: "late",
    excused: "excused",
    excuse: "excused",
    e: "excused",
  };
  return map[s] || null;
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const n = text[i + 1];

    if (inQuotes) {
      if (c === '"' && n === '"') {
        value += '"';
        i += 1;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        value += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(value);
        value = "";
      } else if (c === "\n") {
        row.push(value);
        rows.push(row);
        row = [];
        value = "";
      } else if (c === "\r") {
        // ignore
      } else {
        value += c;
      }
    }
  }

  row.push(value);
  if (row.some((x) => String(x).length > 0)) rows.push(row);
  return rows;
}

const csvEsc = (s) => {
  const v = String(s ?? "");
  if (/[,"\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
};

const buildKpis = async (Attendance, match) => {
  const rows = await Attendance.aggregate([
    { $match: match },
    { $group: { _id: "$status", c: { $sum: 1 } } },
  ]);

  const map = Object.fromEntries(rows.map((r) => [r._id, r.c]));
  return {
    total: Object.values(map).reduce((a, b) => a + b, 0),
    present: map.present || 0,
    absent: map.absent || 0,
    late: map.late || 0,
    excused: map.excused || 0,
  };
};

async function getSubjectRoster(req, { classGroupId, sectionId, streamId } = {}) {
  const { Student } = req.models;

  const filter = { isDeleted: { $ne: true } };
  if (isObjId(classGroupId)) filter.classId = classGroupId;
  if (isObjId(sectionId)) filter.sectionId = sectionId;
  if (isObjId(streamId)) filter.streamId = streamId;

  return Student.find(filter)
    .sort({ fullName: 1 })
    .select("fullName regNo email classId sectionId streamId")
    .lean();
}

const attendanceRules = [
  body("subject").custom((v) => isObjId(v)).withMessage("Subject is required."),
  body("sessionAt").custom((v) => !!parseDateTime(v)).withMessage("Session date/time is required."),
  body("status")
    .optional({ checkFalsy: true })
    .custom((v) => !!normalizeStatus(v))
    .withMessage("Invalid status."),
  body("notes").optional({ checkFalsy: true }).trim().isLength({ max: 500 }),
  body("classGroup")
    .custom((v) => isObjId(v))
    .withMessage("Class is required."),
  body("sectionId")
    .optional({ checkFalsy: true })
    .custom((v) => !v || isObjId(v))
    .withMessage("Invalid section."),
  body("streamId")
    .optional({ checkFalsy: true })
    .custom((v) => !v || isObjId(v))
    .withMessage("Invalid stream."),
  body("teacher")
    .optional({ checkFalsy: true })
    .custom((v) => !v || isObjId(v))
    .withMessage("Invalid teacher."),
  body("term")
    .optional({ checkFalsy: true })
    .isInt({ min: 1, max: 3 })
    .toInt()
    .withMessage("Invalid term."),
  body("academicYear")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 20 }),

  body().custom((_, { req }) => {
    const studentId = req.body.student;
    const regNo = req.body.regNo;
    if (isObjId(studentId)) return true;
    if (String(regNo || "").trim().length >= 2) return true;
    throw new Error("Student is required (select student or provide RegNo).");
  }),
];

module.exports = {
  attendanceRules,

  list: async (req, res) => {
    try {
      const { Attendance, Student, Subject, Class, Staff } = req.models;

      const q = cleanStr(req.query.q, 120);
      const subject = cleanStr(req.query.subject, 80);
      const classGroup = cleanStr(req.query.classGroup, 80);
      const sectionId = cleanStr(req.query.sectionId, 80);
      const streamId = cleanStr(req.query.streamId, 80);
      const status = cleanStr(req.query.status, 20);
      const academicYear = cleanStr(req.query.academicYear, 20);
      const term = cleanStr(req.query.term, 10);
      const from = parseDateTime(req.query.from);
      const to = parseDateTime(req.query.to);

      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const perPage = 20;

      const filter = { isDeleted: { $ne: true } };

      if (subject && isObjId(subject)) filter.subject = subject;
      Object.assign(filter, buildAcademicScopeFilter({ classGroup, sectionId, streamId }));
      if (status && normalizeStatus(status)) filter.status = normalizeStatus(status);
      if (academicYear) filter.academicYear = academicYear;
      if (term && !Number.isNaN(Number(term))) filter.term = Number(term);

      if (from || to) {
        filter.sessionAt = {};
        if (from) filter.sessionAt.$gte = from;
        if (to) filter.sessionAt.$lte = to;
      }

      if (q) {
        const safeQ = escapeRegex(q);
        const studentsFound = await Student.find({
          isDeleted: { $ne: true },
          $or: [
            { fullName: { $regex: safeQ, $options: "i" } },
            { regNo: { $regex: safeQ, $options: "i" } },
            { email: { $regex: safeQ, $options: "i" } },
          ],
        })
          .select("_id")
          .limit(1000)
          .lean();

        const ids = studentsFound.map((s) => s._id);

        if (!ids.length) {
          const subjects = await Subject.find({})
            .sort({ title: 1, code: 1 })
            .select("title code shortTitle classId sectionId streamId")
            .lean();

          const classes = await Class.find({})
            .sort({ name: 1 })
            .select("name code classLevel academicYear term")
            .lean();

          const students = await Student.find({ isDeleted: { $ne: true } })
            .sort({ fullName: 1 })
            .select("fullName regNo email classId sectionId streamId")
            .limit(1000)
            .lean();

          const staffList = await Staff.find({})
            .sort({ fullName: 1, name: 1 })
            .select("fullName name role email")
              .lean();

          const scopeLists = await loadAcademicScopeLists(req);
          return res.render("tenant/attendance/index", {
            tenant: req.tenant || null,
            records: [],
            subjects,
            classes,
            sections: scopeLists.sections,
            streams: scopeLists.streams,
            students,
            subjectOptions: scopeLists.subjects,
            studentOptions: scopeLists.students,
            staffList,
            kpis: { total: 0, present: 0, absent: 0, late: 0, excused: 0 },
            csrfToken: res.locals.csrfToken || null,
            query: {
              q,
              subject,
              classGroup,
              sectionId,
              streamId,
              status,
              academicYear,
              term,
              from: req.query.from || "",
              to: req.query.to || "",
              page: 1,
              perPage,
              total: 0,
              totalPages: 1,
            },
            messages: {
              success: req.flash ? req.flash("success") : [],
              error: req.flash ? req.flash("error") : [],
            },
          });
        }

        filter.student = { $in: ids };
      }

      const total = await Attendance.countDocuments(filter);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);

      const records = await Attendance.find(filter)
        .populate({ path: "student", select: "fullName regNo email" })
        .populate({ path: "subject", select: "title code shortTitle" })
        .populate({ path: "classGroup", select: "name code" })
        .populate({ path: "sectionId", select: "name code" })
        .populate({ path: "streamId", select: "name code" })
        .populate({ path: "teacher", select: "fullName name email role" })
        .sort({ sessionAt: -1, createdAt: -1 })
        .skip((safePage - 1) * perPage)
        .limit(perPage)
        .lean();

      const subjects = await Subject.find({})
        .sort({ title: 1, code: 1 })
        .select("title code shortTitle classId sectionId streamId")
        .lean();

      const classes = await Class.find({})
        .sort({ name: 1 })
        .select("name code classLevel academicYear term")
        .lean();

      const students = await Student.find({ isDeleted: { $ne: true } })
        .sort({ fullName: 1 })
        .select("fullName regNo email classId sectionId streamId")
        .limit(1000)
        .lean();

      const staffList = await Staff.find({})
        .sort({ fullName: 1, name: 1 })
        .select("fullName name role email")
        .lean();

      const kpis = await buildKpis(Attendance, filter);
      const scopeLists = await loadAcademicScopeLists(req);

      return res.render("tenant/attendance/index", {
        tenant: req.tenant || null,
        records,
        subjects,
        classes,
        sections: scopeLists.sections,
        streams: scopeLists.streams,
        students,
        subjectOptions: scopeLists.subjects,
        studentOptions: scopeLists.students,
        staffList,
        kpis,
        csrfToken: res.locals.csrfToken || null,
        query: {
          q,
          subject,
          classGroup,
          sectionId,
          streamId,
          status,
          academicYear,
          term,
          from: req.query.from || "",
          to: req.query.to || "",
          page: safePage,
          perPage,
          total,
          totalPages,
        },
        messages: {
          success: req.flash ? req.flash("success") : [],
          error: req.flash ? req.flash("error") : [],
        },
      });
    } catch (err) {
      console.error("ATTENDANCE LIST ERROR:", err);
      return res.status(500).send("Failed to load attendance.");
    }
  },

  sheet: async (req, res) => {
    try {
      const { Attendance, Subject, Class } = req.models;

      const subjectId = cleanStr(req.query.subject, 80);
      const classGroupId = cleanStr(req.query.classGroup, 80);
      const sectionId = cleanStr(req.query.sectionId, 80);
      const streamId = cleanStr(req.query.streamId, 80);
      const sessionAtRaw = cleanStr(req.query.sessionAt, 40);
      const academicYear = cleanStr(req.query.academicYear, 20);
      const term = Math.max(1, Math.min(Number(req.query.term || 1), 3));
      const sessionAt = parseDateTime(sessionAtRaw);

      const subjects = await Subject.find({})
        .sort({ title: 1, code: 1 })
        .select("title code shortTitle classId sectionId streamId")
        .lean();

      const classes = await Class.find({})
        .sort({ name: 1 })
        .select("name code classLevel academicYear term")
        .lean();

      const scopeLists = await loadAcademicScopeLists(req);

      let selectedSubject = null;
      let selectedClass = null;
      let selectedSection = null;
      let selectedStream = null;
      let roster = [];
      let existingMap = {};

      if (isObjId(subjectId)) {
        selectedSubject = await Subject.findById(subjectId).select("title code shortTitle").lean();
      }

      if (isObjId(classGroupId)) {
        selectedClass = await Class.findById(classGroupId).select("name code").lean();
      }

      if (isObjId(sectionId)) {
        selectedSection = await req.models.Section.findById(sectionId).select("name code").lean();
      }

      if (isObjId(streamId)) {
        selectedStream = await req.models.Stream.findById(streamId).select("name code").lean();
      }

      if (selectedSubject && selectedClass && sessionAt) {
        roster = await getSubjectRoster(req, { classGroupId, sectionId, streamId });

        const existing = await Attendance.find({
          subject: subjectId,
          classGroup: classGroupId,
          ...(isObjId(sectionId) ? { sectionId } : {}),
          ...(isObjId(streamId) ? { streamId } : {}),
          sessionAt,
          isDeleted: { $ne: true },
        })
          .populate({ path: "student", select: "_id regNo" })
          .select("student status notes")
          .lean();

        existing.forEach((row) => {
          const sid = row.student?._id ? String(row.student._id) : "";
          const reg = row.student?.regNo ? String(row.student.regNo) : "";
          if (sid) existingMap[`s:${sid}`] = { status: row.status || "present", notes: row.notes || "" };
          if (reg) existingMap[`r:${reg}`] = { status: row.status || "present", notes: row.notes || "" };
        });
      }

      return res.render("tenant/attendance/sheet", {
        tenant: req.tenant || null,
        subjects,
        classes,
        sections: scopeLists.sections,
        streams: scopeLists.streams,
        subjectOptions: scopeLists.subjects,
        selectedSubject,
        selectedClass,
        selectedSection,
        selectedStream,
        roster,
        existingMap,
        academicYear,
        term,
        sessionAtValue: sessionAt ? new Date(sessionAt).toISOString().slice(0, 16) : "",
        csrfToken: res.locals.csrfToken || null,
        messages: {
          success: req.flash ? req.flash("success") : [],
          error: req.flash ? req.flash("error") : [],
        },
      });
    } catch (err) {
      console.error("ATTENDANCE SHEET ERROR:", err);
      return res.status(500).send("Failed to load attendance sheet.");
    }
  },

  saveSheet: async (req, res) => {
    try {
      const { Attendance, Student, Subject, Class } = req.models;

      const subjectId = cleanStr(req.body.subject, 80);
      const classGroupId = cleanStr(req.body.classGroup, 80);
      const sectionId = cleanStr(req.body.sectionId, 80);
      const streamId = cleanStr(req.body.streamId, 80);
      const sessionAt = parseDateTime(req.body.sessionAt);
      const academicYear = cleanStr(req.body.academicYear, 20);
      const term = Math.max(1, Math.min(Number(req.body.term || 1), 3));

      if (!isObjId(subjectId)) {
        req.flash?.("error", "Subject is required.");
        return res.redirect("/tenant/attendance/sheet");
      }

      if (!isObjId(classGroupId)) {
        req.flash?.("error", "Class is required.");
        return res.redirect(`/tenant/attendance/sheet?subject=${encodeURIComponent(subjectId)}`);
      }

      const subject = await Subject.findById(subjectId).select("_id").lean();
      const classGroup = await Class.findById(classGroupId).select("_id").lean();
      const scope = await resolveAcademicScope(req, { classId: classGroupId, sectionId, streamId });

      if (!subject || !classGroup || scope.errors.length) {
        req.flash?.("error", scope.errors.join(" ") || "Subject or class not found.");
        return res.redirect("/tenant/attendance/sheet");
      }

      if (!sessionAt) {
        req.flash?.("error", "Session date/time is required.");
        return res.redirect(`/tenant/attendance/sheet?subject=${encodeURIComponent(subjectId)}&classGroup=${encodeURIComponent(classGroupId)}`);
      }

      const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
      if (!rows.length) {
        req.flash?.("error", "No attendance rows submitted.");
        return res.redirect(`/tenant/attendance/sheet?subject=${encodeURIComponent(subjectId)}&classGroup=${encodeURIComponent(classGroupId)}&sessionAt=${encodeURIComponent(req.body.sessionAt || "")}`);
      }

      const regNos = rows.map((r) => cleanStr(r.regNo, 60)).filter(Boolean);
      const studentIds = rows.map((r) => cleanStr(r.student, 80)).filter((v) => isObjId(v));

      const students = await Student.find({
        isDeleted: { $ne: true },
        $or: [{ _id: { $in: studentIds } }, { regNo: { $in: regNos } }],
      })
        .select("_id regNo class")
        .lean();

      const byId = new Map();
      const byReg = new Map();
      students.forEach((s) => {
        byId.set(String(s._id), s);
        if (s.regNo) byReg.set(String(s.regNo), s);
      });

      const ops = [];
      let touched = 0;
      const attendanceDate = new Date(sessionAt);
      attendanceDate.setHours(0, 0, 0, 0);

      for (const raw of rows) {
        const status = normalizeStatus(raw.status);
        const notes = cleanStr(raw.notes, 500);
        if (!status) continue;

        const sid = cleanStr(raw.student, 80);
        const regNo = cleanStr(raw.regNo, 60);
        const student = isObjId(sid) ? byId.get(sid) : byReg.get(regNo);
        if (!student?._id) continue;

        ops.push({
          updateOne: {
            filter: {
              student: student._id,
              subject: subjectId,
              sessionAt,
              isDeleted: { $ne: true },
            },
            update: {
              $set: {
                classGroup: classGroupId,
                sectionId: scope.payload.sectionId || null,
                sectionName: scope.payload.sectionName || "",
                sectionCode: scope.payload.sectionCode || "",
                streamId: scope.payload.streamId || null,
                streamName: scope.payload.streamName || "",
                streamCode: scope.payload.streamCode || "",
                academicYear,
                term,
                attendanceDate,
                status,
                notes,
                updatedBy: req.user?._id || null,
              },
              $setOnInsert: {
                student: student._id,
                subject: subjectId,
                sessionAt,
                createdBy: req.user?._id || null,
              },
            },
            upsert: true,
          },
        });

        touched += 1;
      }

      if (!ops.length) {
        req.flash?.("error", "No valid attendance rows to save.");
        return res.redirect(`/tenant/attendance/sheet?subject=${encodeURIComponent(subjectId)}&classGroup=${encodeURIComponent(classGroupId)}&sessionAt=${encodeURIComponent(req.body.sessionAt || "")}`);
      }

      await Attendance.bulkWrite(ops, { ordered: false });

      req.flash?.("success", `Saved ${touched} attendance row(s).`);
      return res.redirect(`/tenant/attendance/sheet?subject=${encodeURIComponent(subjectId)}&classGroup=${encodeURIComponent(classGroupId)}&sectionId=${encodeURIComponent(sectionId)}&streamId=${encodeURIComponent(streamId)}&sessionAt=${encodeURIComponent(req.body.sessionAt || "")}&academicYear=${encodeURIComponent(academicYear)}&term=${encodeURIComponent(term)}`);
    } catch (err) {
      console.error("ATTENDANCE SHEET SAVE ERROR:", err);
      req.flash?.("error", "Failed to save attendance sheet.");
      return res.redirect("/tenant/attendance/sheet");
    }
  },

  create: async (req, res) => {
    const { Attendance, Student, Subject } = req.models;
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/tenant/attendance");
    }

    try {
      const subjectId = cleanStr(req.body.subject, 80);
      const subject = await Subject.findById(subjectId).select("_id").lean();

      if (!subject) {
        req.flash?.("error", "Subject not found.");
        return res.redirect("/tenant/attendance");
      }

      const sessionAt = parseDateTime(req.body.sessionAt);
      if (!sessionAt) {
        req.flash?.("error", "Session date/time is required.");
        return res.redirect("/tenant/attendance");
      }

      const status = normalizeStatus(req.body.status) || "present";
      const notes = cleanStr(req.body.notes, 500);
      const classGroup = isObjId(req.body.classGroup) ? req.body.classGroup : null;
      const sectionId = isObjId(req.body.sectionId) ? req.body.sectionId : null;
      const streamId = isObjId(req.body.streamId) ? req.body.streamId : null;
      const teacher = isObjId(req.body.teacher) ? req.body.teacher : null;
      const academicYear = cleanStr(req.body.academicYear, 20);
      const term = Math.max(1, Math.min(Number(req.body.term || 1), 3));
      const attendanceDate = new Date(sessionAt);
      attendanceDate.setHours(0, 0, 0, 0);

      let studentId = cleanStr(req.body.student, 80);
      if (!isObjId(studentId)) {
        const regNo = cleanStr(req.body.regNo, 60);
        const student = await Student.findOne({ regNo, isDeleted: { $ne: true } }).select("_id").lean();
        if (!student) {
          req.flash?.("error", "Student not found by RegNo.");
          return res.redirect("/tenant/attendance");
        }
        studentId = String(student._id);
      }

      const scope = await resolveAcademicScope(req, { classId: classGroup, sectionId, streamId });
      if (scope.errors.length) {
        req.flash?.("error", scope.errors.join(" "));
        return res.redirect("/tenant/attendance");
      }

      await Attendance.updateOne(
        { student: studentId, subject: subjectId, sessionAt, isDeleted: { $ne: true } },
        {
          $set: {
            student: studentId,
            classGroup: scope.payload.classId || classGroup,
            sectionId: scope.payload.sectionId || null,
            sectionName: scope.payload.sectionName || "",
            sectionCode: scope.payload.sectionCode || "",
            streamId: scope.payload.streamId || null,
            streamName: scope.payload.streamName || "",
            streamCode: scope.payload.streamCode || "",
            subject: subjectId,
            teacher,
            academicYear,
            term,
            attendanceDate,
            sessionAt,
            status,
            notes,
            updatedBy: req.user?._id || null,
          },
          $setOnInsert: {
            createdBy: req.user?._id || null,
          },
        },
        { upsert: true, runValidators: true }
      );

      req.flash?.("success", "Attendance saved.");
      return res.redirect("/tenant/attendance");
    } catch (err) {
      console.error("ATTENDANCE CREATE ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Duplicate attendance record.");
      else req.flash?.("error", "Failed to save attendance.");
      return res.redirect("/tenant/attendance");
    }
  },

  update: async (req, res) => {
    const { Attendance, Student, Subject } = req.models;
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/tenant/attendance");
    }

    try {
      const id = cleanStr(req.params.id, 80);
      if (!isObjId(id)) {
        req.flash?.("error", "Invalid attendance id.");
        return res.redirect("/tenant/attendance");
      }

      const subjectId = cleanStr(req.body.subject, 80);
      const subject = await Subject.findById(subjectId).select("_id").lean();

      if (!subject) {
        req.flash?.("error", "Subject not found.");
        return res.redirect("/tenant/attendance");
      }

      const sessionAt = parseDateTime(req.body.sessionAt);
      if (!sessionAt) {
        req.flash?.("error", "Session date/time is required.");
        return res.redirect("/tenant/attendance");
      }

      const status = normalizeStatus(req.body.status) || "present";
      const notes = cleanStr(req.body.notes, 500);
      const classGroup = isObjId(req.body.classGroup) ? req.body.classGroup : null;
      const sectionId = isObjId(req.body.sectionId) ? req.body.sectionId : null;
      const streamId = isObjId(req.body.streamId) ? req.body.streamId : null;
      const teacher = isObjId(req.body.teacher) ? req.body.teacher : null;
      const academicYear = cleanStr(req.body.academicYear, 20);
      const term = Math.max(1, Math.min(Number(req.body.term || 1), 3));
      const attendanceDate = new Date(sessionAt);
      attendanceDate.setHours(0, 0, 0, 0);

      let studentId = cleanStr(req.body.student, 80);
      if (!isObjId(studentId)) {
        const regNo = cleanStr(req.body.regNo, 60);
        const student = await Student.findOne({ regNo, isDeleted: { $ne: true } }).select("_id").lean();
        if (!student) {
          req.flash?.("error", "Student not found by RegNo.");
          return res.redirect("/tenant/attendance");
        }
        studentId = String(student._id);
      }

      const scope = await resolveAcademicScope(req, { classId: classGroup, sectionId, streamId });
      if (scope.errors.length) {
        req.flash?.("error", scope.errors.join(" "));
        return res.redirect("/tenant/attendance");
      }

      await Attendance.updateOne(
        { _id: id },
        {
          $set: {
            student: studentId,
            classGroup: scope.payload.classId || classGroup,
            sectionId: scope.payload.sectionId || null,
            sectionName: scope.payload.sectionName || "",
            sectionCode: scope.payload.sectionCode || "",
            streamId: scope.payload.streamId || null,
            streamName: scope.payload.streamName || "",
            streamCode: scope.payload.streamCode || "",
            subject: subjectId,
            teacher,
            academicYear,
            term,
            attendanceDate,
            sessionAt,
            status,
            notes,
            updatedBy: req.user?._id || null,
          },
        },
        { runValidators: true }
      );

      req.flash?.("success", "Attendance updated.");
      return res.redirect("/tenant/attendance");
    } catch (err) {
      console.error("ATTENDANCE UPDATE ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Duplicate attendance record.");
      else req.flash?.("error", "Failed to update attendance.");
      return res.redirect("/tenant/attendance");
    }
  },

  remove: async (req, res) => {
    try {
      const { Attendance } = req.models;
      const id = cleanStr(req.params.id, 80);

      if (!isObjId(id)) {
        req.flash?.("error", "Invalid attendance id.");
        return res.redirect("/tenant/attendance");
      }

      await Attendance.deleteOne({ _id: id });
      req.flash?.("success", "Attendance deleted.");
      return res.redirect("/tenant/attendance");
    } catch (err) {
      console.error("ATTENDANCE DELETE ERROR:", err);
      req.flash?.("error", "Failed to delete attendance.");
      return res.redirect("/tenant/attendance");
    }
  },

  bulk: async (req, res) => {
    try {
      const { Attendance } = req.models;

      const action = cleanStr(req.body.action, 30).toLowerCase();
      const status = normalizeStatus(req.body.status);

      const ids = String(req.body.ids || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => isObjId(x));

      if (!ids.length) {
        req.flash?.("error", "No records selected.");
        return res.redirect("/tenant/attendance");
      }

      if (action === "set_status") {
        if (!status) {
          req.flash?.("error", "Choose a valid status.");
          return res.redirect("/tenant/attendance");
        }

        await Attendance.updateMany({ _id: { $in: ids } }, { $set: { status } });
        req.flash?.("success", `Updated ${ids.length} record(s).`);
        return res.redirect("/tenant/attendance");
      }

      if (action === "delete") {
        await Attendance.deleteMany({ _id: { $in: ids } });
        req.flash?.("success", `Deleted ${ids.length} record(s).`);
        return res.redirect("/tenant/attendance");
      }

      req.flash?.("error", "Invalid bulk action.");
      return res.redirect("/tenant/attendance");
    } catch (err) {
      console.error("ATTENDANCE BULK ERROR:", err);
      req.flash?.("error", "Bulk action failed.");
      return res.redirect("/tenant/attendance");
    }
  },

  importTemplate: async (_req, res) => {
    const rows = [
      ["regNo", "subjectCode", "sessionAt", "status", "notes"],
      ["REG/2026/001", "MATH-P4", "2026-03-19 08:00", "present", "On time"],
    ];

    const csv = rows.map((row) => row.map((v) => csvEsc(v)).join(",")).join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="attendance-import-template.csv"');
    return res.send(csv);
  },

  importCsv: async (req, res) => {
    try {
      const { Attendance, Student, Subject } = req.models;

      if (!req.file?.buffer) {
        req.flash?.("error", "CSV file is required.");
        return res.redirect("/tenant/attendance");
      }

      const text = req.file.buffer.toString("utf8");
      const rows = parseCsv(text);

      if (!rows.length) {
        req.flash?.("error", "CSV is empty.");
        return res.redirect("/tenant/attendance");
      }

      const headers = rows[0].map((h) => cleanStr(h, 60).toLowerCase());
      const idx = (name) => headers.findIndex((h) => h === name.toLowerCase());

      const iReg = idx("regno");
      const iSubjectCode = idx("subjectcode");
      const iSessionAt = idx("sessionat");
      const iStatus = idx("status");
      const iNotes = idx("notes");

      if (iReg < 0 || iSubjectCode < 0 || iSessionAt < 0 || iStatus < 0) {
        req.flash?.("error", "Required headers: regNo, subjectCode, sessionAt, status.");
        return res.redirect("/tenant/attendance");
      }

      const allSubjects = await Subject.find({})
        .select("code title")
        .lean();

      const subjectByCode = new Map();
      allSubjects.forEach((s) => {
        const code = String(s.code || "").trim().toUpperCase();
        if (code) subjectByCode.set(code, s);
      });

      const regNos = [];
      for (let r = 1; r < rows.length; r += 1) {
        const regNo = cleanStr(rows[r][iReg], 60);
        if (regNo) regNos.push(regNo);
      }

      const students = await Student.find({ regNo: { $in: regNos }, isDeleted: { $ne: true } })
        .select("_id regNo classId sectionId streamId section stream")
        .lean();

      const studentByReg = new Map();
      students.forEach((s) => studentByReg.set(String(s.regNo).trim(), s));

      const ops = [];
      let imported = 0;

      for (let r = 1; r < rows.length; r += 1) {
        const row = rows[r];

        const regNo = cleanStr(row[iReg], 60);
        const subjectCode = cleanStr(row[iSubjectCode], 40).toUpperCase();
        const sessionAt = parseDateTime(row[iSessionAt]);
        const status = normalizeStatus(row[iStatus]);
        const notes = iNotes >= 0 ? cleanStr(row[iNotes], 500) : "";

        if (!regNo || !subjectCode || !sessionAt || !status) continue;

        const student = studentByReg.get(regNo);
        const subject = subjectByCode.get(subjectCode);
        if (!student || !subject) continue;

        const attendanceDate = new Date(sessionAt);
        attendanceDate.setHours(0, 0, 0, 0);

        ops.push({
          updateOne: {
            filter: { student: student._id, subject: subject._id, sessionAt, isDeleted: { $ne: true } },
            update: {
              $set: {
                classGroup: isObjId(student.classId) ? student.classId : null,
                sectionId: isObjId(student.sectionId) ? student.sectionId : null,
                sectionName: student.section || "",
                streamId: isObjId(student.streamId) ? student.streamId : null,
                streamName: student.stream || "",
                attendanceDate,
                status,
                notes,
                updatedBy: req.user?._id || null,
              },
              $setOnInsert: {
                createdBy: req.user?._id || null,
                student: student._id,
                subject: subject._id,
                sessionAt,
              },
            },
            upsert: true,
          },
        });

        imported += 1;

        if (ops.length >= 500) {
          await Attendance.bulkWrite(ops, { ordered: false });
          ops.length = 0;
        }
      }

      if (ops.length) await Attendance.bulkWrite(ops, { ordered: false });

      if (!imported) {
        req.flash?.("error", "No valid rows imported.");
        return res.redirect("/tenant/attendance");
      }

      req.flash?.("success", `Imported/updated ${imported} attendance record(s).`);
      return res.redirect("/tenant/attendance");
    } catch (err) {
      console.error("ATTENDANCE IMPORT ERROR:", err);
      req.flash?.("error", "Import failed.");
      return res.redirect("/tenant/attendance");
    }
  },

  exportCsv: async (req, res) => {
    try {
      const { Attendance, Student } = req.models;

      const q = cleanStr(req.query.q, 120);
      const subject = cleanStr(req.query.subject, 80);
      const classGroup = cleanStr(req.query.classGroup, 80);
      const sectionId = cleanStr(req.query.sectionId, 80);
      const streamId = cleanStr(req.query.streamId, 80);
      const status = cleanStr(req.query.status, 20);
      const academicYear = cleanStr(req.query.academicYear, 20);
      const term = cleanStr(req.query.term, 10);
      const from = parseDateTime(req.query.from);
      const to = parseDateTime(req.query.to);

      const filter = { isDeleted: { $ne: true } };

      if (subject && isObjId(subject)) filter.subject = subject;
      Object.assign(filter, buildAcademicScopeFilter({ classGroup, sectionId, streamId }));
      if (status && normalizeStatus(status)) filter.status = normalizeStatus(status);
      if (academicYear) filter.academicYear = academicYear;
      if (term && !Number.isNaN(Number(term))) filter.term = Number(term);

      if (from || to) {
        filter.sessionAt = {};
        if (from) filter.sessionAt.$gte = from;
        if (to) filter.sessionAt.$lte = to;
      }

      if (q) {
        const safeQ = escapeRegex(q);
        const studentsFound = await Student.find({
          isDeleted: { $ne: true },
          $or: [
            { fullName: { $regex: safeQ, $options: "i" } },
            { regNo: { $regex: safeQ, $options: "i" } },
            { email: { $regex: safeQ, $options: "i" } },
          ],
        })
          .select("_id")
          .limit(2000)
          .lean();

        const ids = studentsFound.map((s) => s._id);
        if (!ids.length) {
          res.setHeader("Content-Type", "text/csv; charset=utf-8");
          res.setHeader("Content-Disposition", 'attachment; filename="attendance.csv"');
          return res.send("regNo,studentName,email,className,section,stream,subjectCode,subjectTitle,sessionAt,status,notes\n");
        }

        filter.student = { $in: ids };
      }

      const rows = await Attendance.find(filter)
        .populate({ path: "student", select: "fullName regNo email" })
        .populate({ path: "classGroup", select: "name code" })
        .populate({ path: "sectionId", select: "name code" })
        .populate({ path: "streamId", select: "name code" })
        .populate({ path: "subject", select: "code title shortTitle" })
        .sort({ sessionAt: -1 })
        .lean();

      const header = ["regNo", "studentName", "email", "className", "section", "stream", "subjectCode", "subjectTitle", "sessionAt", "status", "notes"];
      const lines = [header.join(",")];

      rows.forEach((a) => {
        const sessionAt = a.sessionAt ? new Date(a.sessionAt).toISOString().slice(0, 16).replace("T", " ") : "";
        lines.push([
          csvEsc(a.student?.regNo || ""),
          csvEsc(a.student?.fullName || ""),
          csvEsc(a.student?.email || ""),
          csvEsc(a.classGroup?.name || ""),
          csvEsc(a.sectionId?.name || a.sectionName || ""),
          csvEsc(a.streamId?.name || a.streamName || ""),
          csvEsc(a.subject?.code || ""),
          csvEsc(a.subject?.title || a.subject?.shortTitle || ""),
          csvEsc(sessionAt),
          csvEsc(a.status || ""),
          csvEsc(a.notes || ""),
        ].join(","));
      });

      const csv = lines.join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="attendance.csv"');
      return res.send(csv);
    } catch (err) {
      console.error("ATTENDANCE EXPORT ERROR:", err);
      return res.status(500).send("Export failed.");
    }
  },
};
