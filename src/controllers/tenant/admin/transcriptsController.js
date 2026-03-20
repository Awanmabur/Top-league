const mongoose = require("mongoose");
const crypto = require("crypto");
const QRCode = require("qrcode");
const { body, validationResult } = require("express-validator");

/* -----------------------------
   Helpers
------------------------------ */
const isObjId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

function safeStr(v, max = 180) {
  return String(v || "").trim().slice(0, max);
}

function clampInt(v, min, max, def) {
  const n = parseInt(String(v ?? ""), 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(n, max));
}

function normalizeAY(ay) {
  return safeStr(ay, 20);
}

function ayInRange(ay, from, to) {
  if (!ay) return true;
  if (from && ay < from) return false;
  if (to && ay > to) return false;
  return true;
}

function studentName(s) {
  return (
    s?.fullName ||
    [s?.firstName, s?.middleName, s?.lastName].filter(Boolean).join(" ") ||
    s?.name ||
    "Student"
  );
}

function studentReg(s) {
  return s?.regNo || s?.registrationNumber || s?.studentNo || s?.indexNumber || "";
}

/* -----------------------------
   GPA / grading
------------------------------ */
const GP = { A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 };

function gradePoint(grade) {
  const g = String(grade || "").trim().toUpperCase();
  return GP[g] ?? 0;
}

function courseCredits(course) {
  const c = course || {};
  const v = c.credits ?? c.creditUnits ?? c.units ?? c.unit ?? c.credit ?? 3;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

function classifyCGPA(cgpa) {
  const x = Number(cgpa || 0);
  if (x >= 4.4) return "First Class";
  if (x >= 3.6) return "Second Class Upper";
  if (x >= 2.8) return "Second Class Lower";
  if (x >= 2.0) return "Pass";
  return "Fail";
}

function semesterDecision(gpa) {
  return Number(gpa || 0) >= 2.0 ? "PASS" : "FAIL";
}

/* -----------------------------
   Signing / verification
------------------------------ */
function hashSnapshot(snapshot) {
  return crypto.createHash("sha256").update(JSON.stringify(snapshot || {})).digest("hex");
}

function signToken(payload) {
  const secret = String(process.env.TRANSCRIPT_SIGNING_SECRET || "");
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function buildVerifyUrl(issueNumber, sig) {
  const base = String(process.env.APP_PUBLIC_URL || "").replace(/\/$/, "") || "";
  return `${base}/admin/transcripts/verify/${encodeURIComponent(issueNumber)}?sig=${encodeURIComponent(sig || "")}`;
}

/* -----------------------------
   Issue number generator
------------------------------ */
async function nextIssueNumber(req) {
  const { Transcript } = req.models;

  const last = await Transcript.findOne({ issueNumber: { $ne: "" } })
    .sort({ createdAt: -1 })
    .select("issueNumber")
    .lean();

  const prev = String(last?.issueNumber || "");
  const m = prev.match(/(\d+)\s*$/);
  const lastNum = m ? parseInt(m[1], 10) : 0;

  const next = lastNum + 1;
  return `CC-TR-${String(next).padStart(6, "0")}`;
}

/* -----------------------------
   Safe populate helpers
------------------------------ */
function hasPath(Model, pathName) {
  return Boolean(Model?.schema?.path(pathName));
}

function getPathRef(Model, pathName) {
  const path = Model?.schema?.path(pathName);
  if (!path) return null;
  if (path.options?.ref) return path.options.ref;
  if (path.caster?.options?.ref) return path.caster.options.ref;
  return null;
}

function canPopulateRef(req, Model, pathName) {
  if (!hasPath(Model, pathName)) return false;
  const refName = getPathRef(Model, pathName);
  if (!refName) return false;
  return Boolean(req.models?.[refName]);
}

function tryPopulate(req, query, Model, pathName, select) {
  if (!canPopulateRef(req, Model, pathName)) return query;
  return query.populate(pathName, select);
}

function getObjName(v) {
  if (!v) return "—";
  if (typeof v === "object") return v.name || v.title || v.code || "—";
  return String(v);
}

/* -----------------------------
   Build safe student query
------------------------------ */
function makeSafeStudentQuery(req, Student, id) {
  let q = Student.findById(id);

  q = tryPopulate(req, q, Student, "program", "name code");
  q = tryPopulate(req, q, Student, "programId", "name code");
  q = tryPopulate(req, q, Student, "programRef", "name code");

  q = tryPopulate(req, q, Student, "classGroup", "name code");
  q = tryPopulate(req, q, Student, "classId", "name code");
  q = tryPopulate(req, q, Student, "classRef", "name code");

  q = tryPopulate(req, q, Student, "department", "name code");
  q = tryPopulate(req, q, Student, "departmentId", "name code");

  q = tryPopulate(req, q, Student, "faculty", "name code");
  q = tryPopulate(req, q, Student, "facultyId", "name code");

  return q;
}

/* -----------------------------
   Build transcript (live)
------------------------------ */
async function buildTranscriptLive(req, transcriptDoc) {
  const { Student, Result } = req.models;
  const t = transcriptDoc;

  const student = await makeSafeStudentQuery(req, Student, t.student).lean();
  if (!student) return null;

  const programName =
    student.program?.name ||
    student.programId?.name ||
    student.programRef?.name ||
    student.programName ||
    student.programTitle ||
    getObjName(student.program) ||
    getObjName(student.programId) ||
    getObjName(student.programRef) ||
    "—";

  const className =
    student.classGroup?.name ||
    student.classId?.name ||
    student.classRef?.name ||
    student.className ||
    student.classGroupName ||
    getObjName(student.classGroup) ||
    getObjName(student.classId) ||
    getObjName(student.classRef) ||
    "—";

  const deptName =
    student.department?.name ||
    student.departmentId?.name ||
    student.departmentName ||
    getObjName(student.department) ||
    getObjName(student.departmentId) ||
    "—";

  const facultyName =
    student.faculty?.name ||
    student.facultyId?.name ||
    student.facultyName ||
    getObjName(student.faculty) ||
    getObjName(student.facultyId) ||
    "—";

  const includeDraft = !!t.includeDraftResults;
  const statusFilter = includeDraft ? { $in: ["draft", "published"] } : "published";

  let resultsQuery = Result.find({
    student: student._id,
    status: statusFilter,
  }).sort({ academicYear: 1, semester: 1, createdAt: 1 });

  resultsQuery = tryPopulate(req, resultsQuery, Result, "course", "code title credits creditUnits units unit");

  const results = await resultsQuery.lean();

  const ayFrom = normalizeAY(t.academicYearFrom);
  const ayTo = normalizeAY(t.academicYearTo);
  const semFrom = clampInt(t.semesterFrom, 0, 6, 0);
  const semTo = clampInt(t.semesterTo, 0, 6, 6);

  const filtered = (results || []).filter((r) => {
    const ay = normalizeAY(r.academicYear || r.year || "");
    const sem = Number(r.semester ?? r.term ?? 1);
    if (!ayInRange(ay, ayFrom, ayTo)) return false;
    if (sem < semFrom || sem > semTo) return false;
    return true;
  });

  const buckets = new Map();
  for (const r of filtered) {
    const ay = normalizeAY(r.academicYear || r.year || "") || "—";
    const sem = Number(r.semester ?? r.term ?? 1);
    const key = `${ay}::${sem}`;
    if (!buckets.has(key)) buckets.set(key, { academicYear: ay, semester: sem, rows: [] });
    buckets.get(key).rows.push(r);
  }

  let cumCredits = 0;
  let cumPoints = 0;

  const semesters = Array.from(buckets.values())
    .sort((a, b) => (a.academicYear > b.academicYear ? 1 : -1) || a.semester - b.semester)
    .map((b) => {
      let semCredits = 0;
      let semPoints = 0;

      const rows = (b.rows || []).map((r) => {
        const cr = courseCredits(r.course);
        const g = String(r.grade || r.letterGrade || "F").toUpperCase();
        const gp = gradePoint(g);
        const pts = cr * gp;

        semCredits += cr;
        semPoints += pts;

        const score = r.score ?? r.marks ?? r.mark ?? 0;
        const total = r.totalMarks ?? r.outOf ?? r.total ?? 100;

        return {
          courseCode: r.course?.code || r.courseCode || "COURSE",
          courseTitle: r.course?.title || r.courseTitle || "",
          credits: cr,
          score,
          total,
          grade: g,
          gp,
          points: pts,
        };
      });

      cumCredits += semCredits;
      cumPoints += semPoints;

      const gpa = semCredits > 0 ? semPoints / semCredits : 0;
      const cgpa = cumCredits > 0 ? cumPoints / cumCredits : 0;

      return {
        academicYear: b.academicYear,
        semester: b.semester,
        rows,
        semCredits,
        semPoints,
        gpa,
        cgpa,
        decision: semesterDecision(gpa),
      };
    });

  const overallCGPA = cumCredits > 0 ? cumPoints / cumCredits : 0;

  return {
    transcriptMeta: {
      _id: t._id,
      kind: t.kind,
      status: t.status,
      issueNumber: t.issueNumber || "",
      issuedAt: t.issuedAt,
      revokedAt: t.revokedAt,
      revokeReason: t.revokeReason || "",
      range: {
        academicYearFrom: ayFrom,
        academicYearTo: ayTo,
        semesterFrom: semFrom,
        semesterTo: semTo,
      },
      includeDraftResults: includeDraft,
      notes: t.notes || "",
    },
    student: {
      _id: student._id,
      name: studentName(student),
      reg: studentReg(student),
      program: programName,
      classGroup: className,
      department: deptName,
      faculty: facultyName,
    },
    totals: {
      credits: cumCredits,
      points: cumPoints,
      cgpa: overallCGPA,
      classification: classifyCGPA(overallCGPA),
    },
    semesters,
  };
}

/* -----------------------------
   Validators
------------------------------ */
const transcriptRules = [
  body("student").custom(isObjId).withMessage("Student is required."),
  body("kind").optional({ checkFalsy: true }).isIn(["official", "unofficial"]),
  body("academicYearFrom").optional({ checkFalsy: true }).trim().isLength({ max: 20 }),
  body("academicYearTo").optional({ checkFalsy: true }).trim().isLength({ max: 20 }),
  body("semesterFrom").optional({ checkFalsy: true }).isInt({ min: 0, max: 6 }).toInt(),
  body("semesterTo").optional({ checkFalsy: true }).isInt({ min: 0, max: 6 }).toInt(),
  body("includeDraftResults").optional().isIn(["0", "1", 0, 1, true, false]),
  body("notes").optional({ checkFalsy: true }).trim().isLength({ max: 500 }),
];

module.exports = {
  transcriptRules,

  list: async (req, res) => {
    try {
      const { Transcript, Student } = req.models;

      const q = safeStr(req.query.q, 120);
      const status = safeStr(req.query.status, 20);
      const kind = safeStr(req.query.kind, 20);
      const tid = safeStr(req.query.tid, 60);

      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const perPage = 10;

      const filter = {};
      if (status && ["draft", "issued", "revoked"].includes(status)) filter.status = status;
      if (kind && ["official", "unofficial"].includes(kind)) filter.kind = kind;

      if (q) {
        const students = await Student.find({
          $or: [
            { fullName: { $regex: q, $options: "i" } },
            { name: { $regex: q, $options: "i" } },
            { regNo: { $regex: q, $options: "i" } },
            { studentNo: { $regex: q, $options: "i" } },
            { indexNumber: { $regex: q, $options: "i" } },
          ],
        })
          .select("_id")
          .limit(250)
          .lean();

        filter.student = students.length ? { $in: students.map((s) => s._id) } : "__none__";
      }

      const total = await Transcript.countDocuments(filter);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);

      const transcripts = await Transcript.find(filter)
        .populate("student", "fullName firstName middleName lastName regNo studentNo indexNumber name")
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * perPage)
        .limit(perPage)
        .lean();

      const studentsList = await Student.find({})
        .select("fullName firstName middleName lastName regNo studentNo indexNumber name")
        .sort({ fullName: 1, firstName: 1, lastName: 1 })
        .limit(2500)
        .lean();

      let preview = null;
      let previewId = null;

      if (tid && mongoose.Types.ObjectId.isValid(tid)) previewId = tid;
      else if (transcripts[0]?._id) previewId = transcripts[0]._id;

      if (previewId) {
        const tdoc = await Transcript.findById(previewId).lean();
        if (tdoc) {
          preview = tdoc.status === "issued" && tdoc.snapshot
            ? tdoc.snapshot
            : await buildTranscriptLive(req, tdoc);
        }
      }

      const kpis = {
        total,
        draft: await Transcript.countDocuments({ ...filter, status: "draft" }),
        issued: await Transcript.countDocuments({ ...filter, status: "issued" }),
        revoked: await Transcript.countDocuments({ ...filter, status: "revoked" }),
      };

      return res.render("tenant/admin/transcripts/index", {
        tenant: req.tenant || null,
        transcripts,
        studentsList,
        preview,
        csrfToken: res.locals.csrfToken || null,
        kpis,
        query: { q, status, kind, tid: previewId, page: safePage, total, totalPages, perPage },
        messages: {
          success: req.flash ? req.flash("success") : [],
          error: req.flash ? req.flash("error") : [],
        },
      });
    } catch (err) {
      console.error("TRANSCRIPTS LIST ERROR:", err);
      return res.status(500).send("Failed to load transcripts.");
    }
  },

  create: async (req, res) => {
    const { Transcript } = req.models;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/transcripts");
    }

    try {
      const t = await Transcript.create({
        student: String(req.body.student || "").trim(),
        kind: ["official", "unofficial"].includes(req.body.kind) ? req.body.kind : "official",
        academicYearFrom: normalizeAY(req.body.academicYearFrom),
        academicYearTo: normalizeAY(req.body.academicYearTo),
        semesterFrom: clampInt(req.body.semesterFrom, 0, 6, 0),
        semesterTo: clampInt(req.body.semesterTo, 0, 6, 6),
        includeDraftResults: String(req.body.includeDraftResults || "0") === "1",
        notes: safeStr(req.body.notes, 500),
        status: "draft",
      });

      req.flash?.("success", "Transcript created.");
      return res.redirect(`/admin/transcripts?tid=${encodeURIComponent(t._id)}`);
    } catch (err) {
      console.error("CREATE TRANSCRIPT ERROR:", err);
      req.flash?.("error", "Failed to create transcript.");
      return res.redirect("/admin/transcripts");
    }
  },

  update: async (req, res) => {
    const { Transcript } = req.models;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/transcripts");
    }

    try {
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid transcript id.");
        return res.redirect("/admin/transcripts");
      }

      const existing = await Transcript.findById(id).lean();
      if (!existing) {
        req.flash?.("error", "Transcript not found.");
        return res.redirect("/admin/transcripts");
      }

      if (existing.status === "issued") {
        req.flash?.("error", "Issued transcripts cannot be edited. Clone instead.");
        return res.redirect(`/admin/transcripts?tid=${encodeURIComponent(id)}`);
      }

      await Transcript.updateOne(
        { _id: id },
        {
          $set: {
            student: String(req.body.student || "").trim(),
            kind: ["official", "unofficial"].includes(req.body.kind) ? req.body.kind : "official",
            academicYearFrom: normalizeAY(req.body.academicYearFrom),
            academicYearTo: normalizeAY(req.body.academicYearTo),
            semesterFrom: clampInt(req.body.semesterFrom, 0, 6, 0),
            semesterTo: clampInt(req.body.semesterTo, 0, 6, 6),
            includeDraftResults: String(req.body.includeDraftResults || "0") === "1",
            notes: safeStr(req.body.notes, 500),
          },
        },
        { runValidators: true }
      );

      req.flash?.("success", "Transcript updated.");
      return res.redirect(`/admin/transcripts?tid=${encodeURIComponent(id)}`);
    } catch (err) {
      console.error("UPDATE TRANSCRIPT ERROR:", err);
      req.flash?.("error", "Failed to update transcript.");
      return res.redirect("/admin/transcripts");
    }
  },

  clone: async (req, res) => {
    try {
      const { Transcript } = req.models;
      const id = String(req.params.id || "").trim();

      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid transcript id.");
        return res.redirect("/admin/transcripts");
      }

      const t = await Transcript.findById(id).lean();
      if (!t) {
        req.flash?.("error", "Transcript not found.");
        return res.redirect("/admin/transcripts");
      }

      const copy = await Transcript.create({
        student: t.student,
        kind: t.kind || "official",
        academicYearFrom: t.academicYearFrom || "",
        academicYearTo: t.academicYearTo || "",
        semesterFrom: t.semesterFrom ?? 0,
        semesterTo: t.semesterTo ?? 6,
        includeDraftResults: !!t.includeDraftResults,
        notes: `Cloned from ${t.issueNumber || t._id}. ${t.notes || ""}`.trim(),
        status: "draft",
      });

      req.flash?.("success", "Transcript cloned as draft.");
      return res.redirect(`/admin/transcripts?tid=${encodeURIComponent(copy._id)}`);
    } catch (err) {
      console.error("CLONE TRANSCRIPT ERROR:", err);
      req.flash?.("error", "Failed to clone transcript.");
      return res.redirect("/admin/transcripts");
    }
  },

  issue: async (req, res) => {
    try {
      const { Transcript } = req.models;
      const id = String(req.params.id || "").trim();

      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid transcript id.");
        return res.redirect("/admin/transcripts");
      }

      const tdoc = await Transcript.findById(id).lean();
      if (!tdoc) {
        req.flash?.("error", "Transcript not found.");
        return res.redirect("/admin/transcripts");
      }

      if (tdoc.status === "issued") {
        req.flash?.("error", "Already issued.");
        return res.redirect(`/admin/transcripts?tid=${encodeURIComponent(id)}`);
      }

      const live = await buildTranscriptLive(req, tdoc);
      if (!live) {
        req.flash?.("error", "Cannot issue: student not found.");
        return res.redirect(`/admin/transcripts?tid=${encodeURIComponent(id)}`);
      }

      if (!live.semesters?.length) {
        req.flash?.("error", "Cannot issue: no results found for selected range.");
        return res.redirect(`/admin/transcripts?tid=${encodeURIComponent(id)}`);
      }

      const issueNumber = await nextIssueNumber(req);
      const issuedAt = new Date();

      const snapshot = {
        ...live,
        transcriptMeta: {
          ...live.transcriptMeta,
          status: "issued",
          issueNumber,
          issuedAt,
          issuedBy: req.user?._id || null,
        },
      };

      const snapshotHash = hashSnapshot(snapshot);

      await Transcript.updateOne(
        { _id: id },
        {
          $set: {
            status: "issued",
            issueNumber,
            issuedAt,
            issuedBy: req.user?._id || null,
            revokedAt: null,
            revokedBy: null,
            revokeReason: "",
            snapshot,
            snapshotHash,
          },
        }
      );

      req.flash?.("success", `Transcript issued (${issueNumber}).`);
      return res.redirect(`/admin/transcripts?tid=${encodeURIComponent(id)}`);
    } catch (err) {
      console.error("ISSUE TRANSCRIPT ERROR:", err);
      req.flash?.("error", "Failed to issue transcript.");
      return res.redirect("/admin/transcripts");
    }
  },

  revoke: async (req, res) => {
    try {
      const { Transcript } = req.models;
      const id = String(req.params.id || "").trim();
      const reason = safeStr(req.body.reason, 200);

      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid transcript id.");
        return res.redirect("/admin/transcripts");
      }

      await Transcript.updateOne(
        { _id: id },
        {
          $set: {
            status: "revoked",
            revokedAt: new Date(),
            revokedBy: req.user?._id || null,
            revokeReason: reason,
          },
        }
      );

      req.flash?.("success", "Transcript revoked.");
      return res.redirect(`/admin/transcripts?tid=${encodeURIComponent(id)}`);
    } catch (err) {
      console.error("REVOKE TRANSCRIPT ERROR:", err);
      req.flash?.("error", "Failed to revoke transcript.");
      return res.redirect("/admin/transcripts");
    }
  },

  remove: async (req, res) => {
    try {
      const { Transcript } = req.models;
      const id = String(req.params.id || "").trim();

      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid transcript id.");
        return res.redirect("/admin/transcripts");
      }

      await Transcript.deleteOne({ _id: id });
      req.flash?.("success", "Transcript deleted.");
      return res.redirect("/admin/transcripts");
    } catch (err) {
      console.error("DELETE TRANSCRIPT ERROR:", err);
      req.flash?.("error", "Failed to delete transcript.");
      return res.redirect("/admin/transcripts");
    }
  },

  bulk: async (req, res) => {
    try {
      const { Transcript } = req.models;
      const action = safeStr(req.body.action, 20);

      const ids = String(req.body.ids || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => mongoose.Types.ObjectId.isValid(x));

      if (!ids.length) {
        req.flash?.("error", "No transcripts selected.");
        return res.redirect("/admin/transcripts");
      }

      if (action === "delete") {
        await Transcript.deleteMany({ _id: { $in: ids } });
        req.flash?.("success", "Selected transcripts deleted.");
      } else if (action === "revoke") {
        await Transcript.updateMany(
          { _id: { $in: ids } },
          { $set: { status: "revoked", revokedAt: new Date() } }
        );
        req.flash?.("success", "Selected transcripts revoked.");
      } else {
        req.flash?.("error", "Invalid bulk action.");
      }

      return res.redirect("/admin/transcripts");
    } catch (err) {
      console.error("TRANSCRIPT BULK ERROR:", err);
      req.flash?.("error", "Bulk action failed.");
      return res.redirect("/admin/transcripts");
    }
  },

  printView: async (req, res) => {
    try {
      const { Transcript } = req.models;
      const id = String(req.params.id || "").trim();

      if (!mongoose.Types.ObjectId.isValid(id)) return res.status(404).send("Not found.");

      const tdoc = await Transcript.findById(id).lean();
      if (!tdoc) return res.status(404).send("Not found.");

      const data = tdoc.status === "issued" && tdoc.snapshot
        ? tdoc.snapshot
        : await buildTranscriptLive(req, tdoc);

      if (!data) return res.status(404).send("Not found.");

      data.snapshotHash = tdoc.snapshotHash || "";

      let qrDataUrl = "";
      let verifyUrl = "";

      if (tdoc.status === "issued" && tdoc.issueNumber && tdoc.issuedAt) {
        const payload = `${tdoc.issueNumber}|${new Date(tdoc.issuedAt).toISOString()}`;
        const sig = signToken(payload);
        verifyUrl = buildVerifyUrl(tdoc.issueNumber, sig);
        qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 240 });
      }

      return res.render("tenant/admin/transcripts/print", {
        tenant: req.tenant || null,
        data,
        qrDataUrl,
        verifyUrl,
      });
    } catch (err) {
      console.error("PRINT TRANSCRIPT ERROR:", err);
      return res.status(500).send("Failed to render transcript.");
    }
  },

  verifyPage: async (req, res) => {
    try {
      const { Transcript } = req.models;
      const issueNumber = safeStr(req.params.issueNumber, 60);
      const sig = safeStr(req.query.sig, 200);

      const tdoc = await Transcript.findOne({ issueNumber }).lean();

      let ok = false;
      let reason = "";
      let minimal = null;

      if (!tdoc) {
        reason = "Transcript not found.";
      } else {
        const issuedAtISO = tdoc.issuedAt ? new Date(tdoc.issuedAt).toISOString() : "";
        const payload = `${issueNumber}|${issuedAtISO}`;
        const expected = signToken(payload);

        if (!expected) reason = "Verification secret not configured on server.";
        else if (!sig || sig !== expected) reason = "Invalid verification signature.";
        else if (tdoc.status === "revoked") reason = "This transcript has been revoked.";
        else if (tdoc.status !== "issued") reason = "This transcript is not issued.";
        else ok = true;

        minimal = {
          issueNumber,
          status: tdoc.status,
          issuedAt: tdoc.issuedAt,
          revokedAt: tdoc.revokedAt,
          revokeReason: tdoc.revokeReason || "",
          snapshotHash: tdoc.snapshotHash || "",
          studentName: tdoc.snapshot?.student?.name || "—",
          reg: tdoc.snapshot?.student?.reg || "—",
          program: tdoc.snapshot?.student?.program || "—",
          cgpa: tdoc.snapshot?.totals?.cgpa ?? 0,
          classification: tdoc.snapshot?.totals?.classification || "—",
        };
      }

      return res.render("public/verify-transcript", { ok, reason, minimal });
    } catch (err) {
      console.error("VERIFY TRANSCRIPT ERROR:", err);
      return res.status(500).send("Verification failed.");
    }
  },

  verifyApi: async (req, res) => {
    try {
      const { Transcript } = req.models;
      const issueNumber = safeStr(req.params.issueNumber, 60);
      const sig = safeStr(req.query.sig, 200);

      const tdoc = await Transcript.findOne({ issueNumber }).lean();
      if (!tdoc) return res.status(404).json({ ok: false, reason: "Not found" });

      const issuedAtISO = tdoc.issuedAt ? new Date(tdoc.issuedAt).toISOString() : "";
      const payload = `${issueNumber}|${issuedAtISO}`;
      const expected = signToken(payload);

      if (!expected) return res.status(500).json({ ok: false, reason: "Signing secret missing" });
      if (!sig || sig !== expected) return res.status(401).json({ ok: false, reason: "Bad signature" });

      if (tdoc.status !== "issued") {
        return res.json({
          ok: false,
          status: tdoc.status,
          revokedAt: tdoc.revokedAt,
          revokeReason: tdoc.revokeReason || "",
        });
      }

      return res.json({
        ok: true,
        status: tdoc.status,
        issueNumber,
        issuedAt: tdoc.issuedAt,
        snapshotHash: tdoc.snapshotHash,
        student: tdoc.snapshot?.student || null,
        totals: tdoc.snapshot?.totals || null,
      });
    } catch (err) {
      console.error("VERIFY API ERROR:", err);
      return res.status(500).json({ ok: false, reason: "Server error" });
    }
  },
};