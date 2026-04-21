const mongoose = require("mongoose");
const crypto = require("crypto");
const QRCode = require("qrcode");
const { body, validationResult } = require("express-validator");
const { loadAcademicScopeLists, buildAcademicScopeFilter, resolveAcademicScope } = require("../../../utils/tenantAcademicScope");

const isObjId = (v) => mongoose.Types.ObjectId.isValid(String(v || "").trim());

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

function studentName(s) {
  return (
    s?.fullName ||
    [s?.firstName, s?.middleName, s?.lastName].filter(Boolean).join(" ") ||
    s?.name ||
    "Learner"
  );
}

function studentReg(s) {
  return s?.regNo || s?.registrationNumber || s?.studentNo || s?.indexNumber || "";
}

function defaultGrading(percentage) {
  const p = Number(percentage || 0);
  if (p >= 80) return { grade: "A", remark: "Excellent" };
  if (p >= 75) return { grade: "A-", remark: "Very Good" };
  if (p >= 70) return { grade: "B+", remark: "Very Good" };
  if (p >= 65) return { grade: "B", remark: "Good" };
  if (p >= 60) return { grade: "B-", remark: "Good" };
  if (p >= 55) return { grade: "C+", remark: "Satisfactory" };
  if (p >= 50) return { grade: "C", remark: "Satisfactory" };
  if (p >= 45) return { grade: "C-", remark: "Pass" };
  if (p >= 40) return { grade: "D", remark: "Pass" };
  return { grade: "F", remark: "Fail" };
}

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
  return `${base}/verify/transcript/${encodeURIComponent(issueNumber)}?sig=${encodeURIComponent(sig || "")}`;
}

async function nextIssueNumber(req) {
  const { Transcript } = req.models;

  const last = await Transcript.findOne({ issueNumber: { $ne: "" } })
    .sort({ createdAt: -1 })
    .select("issueNumber")
    .lean();

  const prev = String(last?.issueNumber || "");
  const m = prev.match(/(\d+)\s*$/);
  const lastNum = m ? parseInt(m[1], 10) : 0;

  return `CA-TR-${String(lastNum + 1).padStart(6, "0")}`;
}

function transcriptRules() {
  return [
    body("student").custom((v) => isObjId(v)).withMessage("Learner is required."),
    body("classGroup").optional({ checkFalsy: true }).custom((v) => isObjId(v)).withMessage("Invalid class."),
    body("sectionId").optional({ checkFalsy: true }).custom((v) => isObjId(v)).withMessage("Invalid section."),
    body("streamId").optional({ checkFalsy: true }).custom((v) => isObjId(v)).withMessage("Invalid stream."),
    body("kind").optional({ checkFalsy: true }).isIn(["official", "unofficial"]),
    body("rangeMode").optional({ checkFalsy: true }).isIn(["auto", "current_term", "all_available", "custom"]),
    body("academicYearFrom").optional({ checkFalsy: true }).trim().isLength({ max: 20 }),
    body("academicYearTo").optional({ checkFalsy: true }).trim().isLength({ max: 20 }),
    body("termFrom").optional({ checkFalsy: true }).isInt({ min: 1, max: 3 }).toInt(),
    body("termTo").optional({ checkFalsy: true }).isInt({ min: 1, max: 3 }).toInt(),
    body("includeDraftResults").optional().isIn(["0", "1", 0, 1, true, false]),
    body("notes").optional({ checkFalsy: true }).trim().isLength({ max: 1000 }),
    body("teacherComment").optional({ checkFalsy: true }).trim().isLength({ max: 1000 }),
    body("headTeacherComment").optional({ checkFalsy: true }).trim().isLength({ max: 1000 }),
  ];
}

function transcriptScopeFilter(transcriptDoc) {
  return buildAcademicScopeFilter({
    classGroup: transcriptDoc.classGroup,
    sectionId: transcriptDoc.sectionId,
    streamId: transcriptDoc.streamId,
  });
}

async function getRangeFromResults(req, studentId, includeDraft, scopeFilter = {}) {
  const { Result } = req.models;
  const statusFilter = includeDraft ? { $in: ["draft", "published"] } : "published";

  const rows = await Result.find({ student: studentId, status: statusFilter, ...scopeFilter })
    .select("academicYear term")
    .sort({ academicYear: 1, term: 1 })
    .lean();

  if (!rows.length) {
    return {
      academicYearFrom: "",
      academicYearTo: "",
      termFrom: 1,
      termTo: 3,
      found: false,
    };
  }

  const years = rows.map((r) => String(r.academicYear || "").trim()).filter(Boolean).sort();
  const terms = rows.map((r) => Number(r.term || 1)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);

  return {
    academicYearFrom: years[0] || "",
    academicYearTo: years[years.length - 1] || "",
    termFrom: terms[0] || 1,
    termTo: terms[terms.length - 1] || 3,
    found: true,
  };
}

async function getCurrentRange(req, studentId, includeDraft, scopeFilter = {}) {
  const { Result } = req.models;
  const statusFilter = includeDraft ? { $in: ["draft", "published"] } : "published";

  const row = await Result.findOne({ student: studentId, status: statusFilter, ...scopeFilter })
    .select("academicYear term")
    .sort({ academicYear: -1, term: -1, createdAt: -1 })
    .lean();

  if (!row) {
    return {
      academicYearFrom: "",
      academicYearTo: "",
      termFrom: 1,
      termTo: 1,
      found: false,
    };
  }

  const ay = String(row.academicYear || "").trim();
  const term = clampInt(row.term || 1, 1, 3, 1);

  return {
    academicYearFrom: ay,
    academicYearTo: ay,
    termFrom: term,
    termTo: term,
    found: true,
  };
}

async function resolveRange(req, transcriptDoc) {
  const rangeMode = String(transcriptDoc.rangeMode || "auto").trim();
  const includeDraft = !!transcriptDoc.includeDraftResults;
  const studentId = transcriptDoc.student;
  const scopeFilter = transcriptScopeFilter(transcriptDoc);

  if (rangeMode === "all_available" || rangeMode === "auto") {
    const all = await getRangeFromResults(req, studentId, includeDraft, scopeFilter);
    if (all.found) return all;
  }

  if (rangeMode === "current_term") {
    const cur = await getCurrentRange(req, studentId, includeDraft, scopeFilter);
    if (cur.found) return cur;
  }

  return {
    academicYearFrom: normalizeAY(transcriptDoc.academicYearFrom),
    academicYearTo: normalizeAY(transcriptDoc.academicYearTo),
    termFrom: clampInt(transcriptDoc.termFrom, 1, 3, 1),
    termTo: clampInt(transcriptDoc.termTo, 1, 3, 3),
    found: true,
  };
}

async function buildTranscriptLive(req, transcriptDoc) {
  const { Student, Result, Attendance, Class, Section, Stream } = req.models;
  const t = transcriptDoc;

  const student = await Student.findById(t.student).lean();

  if (!student) return null;

  const [classDoc, sectionDoc, streamDoc] = await Promise.all([
    t.classGroup ? Class.findById(t.classGroup).select("name code").lean().catch(() => null) : null,
    t.sectionId ? Section.findById(t.sectionId).select("name code").lean().catch(() => null) : null,
    t.streamId ? Stream.findById(t.streamId).select("name code").lean().catch(() => null) : null,
  ]);

  const className =
    t.classGroupName ||
    classDoc?.name ||
    classDoc?.code ||
    student.className ||
    "—";

  const sectionName =
    t.sectionName ||
    sectionDoc?.name ||
    student.section ||
    "—";

  const streamName =
    t.streamName ||
    streamDoc?.name ||
    student.stream ||
    "—";

  const includeDraft = !!t.includeDraftResults;
  const statusFilter = includeDraft ? { $in: ["draft", "published"] } : "published";
  const range = await resolveRange(req, t);
  const scopeFilter = transcriptScopeFilter(t);

  const results = await Result.find({
    student: student._id,
    status: statusFilter,
    ...scopeFilter,
  })
    .populate("subject", "title code shortTitle")
    .populate("exam", "title")
    .sort({ academicYear: 1, term: 1, createdAt: 1 })
    .lean();

  const filtered = results.filter((r) => {
    const ay = normalizeAY(r.academicYear || "");
    const term = clampInt(r.term, 1, 3, 1);

    if (range.academicYearFrom && ay < range.academicYearFrom) return false;
    if (range.academicYearTo && ay > range.academicYearTo) return false;
    if (term < range.termFrom || term > range.termTo) return false;
    return true;
  });

  const attendanceRows = await Attendance.find({
    student: student._id,
    academicYear: { $gte: range.academicYearFrom || "", $lte: range.academicYearTo || "zzzz" },
    term: { $gte: range.termFrom, $lte: range.termTo },
    ...scopeFilter,
  })
    .select("status")
    .lean();

  const attendanceSummary = {
    present: attendanceRows.filter((x) => x.status === "present").length,
    absent: attendanceRows.filter((x) => x.status === "absent").length,
    late: attendanceRows.filter((x) => x.status === "late").length,
    excused: attendanceRows.filter((x) => x.status === "excused").length,
  };

  const buckets = new Map();

  for (const r of filtered) {
    const ay = normalizeAY(r.academicYear || "") || "—";
    const term = clampInt(r.term, 1, 3, 1);
    const key = `${ay}::${term}`;

    if (!buckets.has(key)) {
      buckets.set(key, {
        academicYear: ay,
        term,
        rows: [],
      });
    }

    const percentage = Number(r.percentage || 0);
    const auto = defaultGrading(percentage);

    buckets.get(key).rows.push({
      subjectCode: r.subject?.code || "",
      subjectTitle: r.subject?.title || r.subject?.shortTitle || "Subject",
      examTitle: r.exam?.title || "Exam",
      score: Number(r.score || 0),
      total: Number(r.totalMarks || 100),
      percentage,
      grade: r.grade || auto.grade,
      remark: r.remark || auto.remark,
    });
  }

  const terms = Array.from(buckets.values())
    .sort((a, b) => (a.academicYear > b.academicYear ? 1 : -1) || a.term - b.term)
    .map((bucket) => {
      const avg = bucket.rows.length
        ? Math.round((bucket.rows.reduce((a, x) => a + (Number(x.percentage) || 0), 0) / bucket.rows.length) * 100) / 100
        : 0;

      const overall = defaultGrading(avg);

      return {
        academicYear: bucket.academicYear,
        term: bucket.term,
        rows: bucket.rows,
        average: avg,
        grade: overall.grade,
        remark: overall.remark,
      };
    });

  const allRows = terms.flatMap((x) => x.rows);
  const overallAverage = allRows.length
    ? Math.round((allRows.reduce((a, x) => a + (Number(x.percentage) || 0), 0) / allRows.length) * 100) / 100
    : 0;

  const overall = defaultGrading(overallAverage);

  return {
    transcriptMeta: {
      _id: t._id,
      kind: t.kind || "official",
      status: t.status || "draft",
      issueNumber: t.issueNumber || "",
      issuedAt: t.issuedAt || null,
      revokedAt: t.revokedAt || null,
      revokeReason: t.revokeReason || "",
      rangeMode: t.rangeMode || "auto",
      range,
      includeDraftResults: includeDraft,
      notes: t.notes || "",
      teacherComment: t.teacherComment || "",
      headTeacherComment: t.headTeacherComment || "",
    },
    student: {
      _id: student._id,
      name: studentName(student),
      reg: studentReg(student),
      classGroup: className,
      section: sectionName,
      stream: streamName,
    },
    totals: {
      subjects: allRows.length,
      average: overallAverage,
      overallGrade: overall.grade,
      overallRemark: overall.remark,
      attendanceSummary,
    },
    terms,
  };
}

async function generateOne(req, payload, existingId = null) {
  const { Transcript } = req.models;

  const scope = await resolveAcademicScope(req, {
    classId: payload.classGroup || payload.classId || "",
    sectionId: payload.sectionId || "",
    streamId: payload.streamId || "",
  });

  if (scope.errors.length) {
    return { ok: false, id: existingId || null, reason: scope.errors[0] };
  }

  const base = {
    student: payload.student,
    classGroup: scope.payload.classId || payload.classGroup || null,
    classGroupName: scope.payload.className || "",
    sectionId: scope.payload.sectionId || null,
    sectionName: scope.payload.sectionName || "",
    sectionCode: scope.payload.sectionCode || "",
    streamId: scope.payload.streamId || null,
    streamName: scope.payload.streamName || "",
    streamCode: scope.payload.streamCode || "",
    kind: ["official", "unofficial"].includes(payload.kind) ? payload.kind : "official",
    rangeMode: ["auto", "current_term", "all_available", "custom"].includes(payload.rangeMode) ? payload.rangeMode : "auto",
    academicYearFrom: normalizeAY(payload.academicYearFrom),
    academicYearTo: normalizeAY(payload.academicYearTo),
    termFrom: clampInt(payload.termFrom, 1, 3, 1),
    termTo: clampInt(payload.termTo, 1, 3, 3),
    includeDraftResults: String(payload.includeDraftResults || "0") === "1" || payload.includeDraftResults === true,
    notes: safeStr(payload.notes, 1000),
    teacherComment: safeStr(payload.teacherComment, 1000),
    headTeacherComment: safeStr(payload.headTeacherComment, 1000),
    autoGenerated: true,
    status: "draft",
    generatedAt: new Date(),
    updatedBy: req.user?._id || null,
  };

  let tdoc;
  if (existingId) {
    await Transcript.updateOne({ _id: existingId }, { $set: base });
    tdoc = await Transcript.findById(existingId).lean();
  } else {
    tdoc = await Transcript.create({
      ...base,
      createdBy: req.user?._id || null,
    });
    tdoc = tdoc.toObject();
  }

  const live = await buildTranscriptLive(req, tdoc);
  if (!live || !live.terms?.length) {
    return { ok: false, id: tdoc._id, reason: "No results found for selected range." };
  }

  await Transcript.updateOne(
    { _id: tdoc._id },
    {
      $set: {
        snapshot: live,
        snapshotHash: hashSnapshot(live),
        generatedAt: new Date(),
      },
    }
  );

  return { ok: true, id: tdoc._id, live };
}

module.exports = {
  transcriptRules: transcriptRules(),

  list: async (req, res) => {
    try {
      const { Transcript, Student, Class, Section, Stream } = req.models;

      const q = safeStr(req.query.q, 120);
      const status = safeStr(req.query.status, 20);
      const kind = safeStr(req.query.kind, 20);
      const classGroup = safeStr(req.query.classGroup, 60);
      const sectionId = safeStr(req.query.sectionId, 60);
      const streamId = safeStr(req.query.streamId, 60);
      const tid = safeStr(req.query.tid, 60);

      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const perPage = 10;

      const filter = {};
      if (status && ["draft", "issued", "revoked"].includes(status)) filter.status = status;
      if (kind && ["official", "unofficial"].includes(kind)) filter.kind = kind;
      Object.assign(filter, buildAcademicScopeFilter({ classGroup, sectionId, streamId }));

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
          .limit(1000)
          .lean();

        filter.student = students.length ? { $in: students.map((s) => s._id) } : "__none__";
      }

      const total = await Transcript.countDocuments(filter);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);

      const transcripts = await Transcript.find(filter)
        .populate("student", "fullName firstName middleName lastName regNo studentNo indexNumber name classId className sectionId section streamId stream")
        .populate("classGroup", "name code")
        .populate("sectionId", "name code")
        .populate("streamId", "name code")
        .sort({ updatedAt: -1, _id: -1 })
        .skip((safePage - 1) * perPage)
        .limit(perPage)
        .lean();

      const scopeLists = await loadAcademicScopeLists(req);

      const studentsList = await Student.find({})
        .select("fullName firstName middleName lastName regNo studentNo indexNumber name classId className sectionId section streamId stream")
        .sort({ fullName: 1, firstName: 1, lastName: 1 })
        .limit(4000)
        .lean();

      const classes = await Class.find({})
        .select("name code")
        .sort({ name: 1 })
        .lean();

      let preview = null;
      let previewId = null;

      if (tid && isObjId(tid)) previewId = tid;
      else if (transcripts[0]?._id) previewId = String(transcripts[0]._id);

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

      return res.render("tenant/transcripts/index", {
        tenant: req.tenant || null,
        transcripts,
        studentsList,
        studentsData: scopeLists.students,
        classes,
        sections: scopeLists.sections,
        streams: scopeLists.streams,
        preview,
        csrfToken: res.locals.csrfToken || null,
        kpis,
        query: { q, status, kind, classGroup, sectionId, streamId, tid: previewId, page: safePage, total, totalPages, perPage },
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
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/transcripts");
    }

    try {
      const out = await generateOne(req, req.body);
      if (!out.ok) {
        req.flash?.("error", out.reason || "Failed to generate transcript.");
        return res.redirect("/admin/transcripts");
      }

      req.flash?.("success", "Transcript generated automatically.");
      return res.redirect(`/admin/transcripts?tid=${encodeURIComponent(out.id)}`);
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
      if (!isObjId(id)) {
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

      const out = await generateOne(req, req.body, id);
      if (!out.ok) {
        req.flash?.("error", out.reason || "Failed to regenerate transcript.");
        return res.redirect(`/admin/transcripts?tid=${encodeURIComponent(id)}`);
      }

      req.flash?.("success", "Transcript regenerated.");
      return res.redirect(`/admin/transcripts?tid=${encodeURIComponent(id)}`);
    } catch (err) {
      console.error("UPDATE TRANSCRIPT ERROR:", err);
      req.flash?.("error", "Failed to update transcript.");
      return res.redirect("/admin/transcripts");
    }
  },

  bulkGenerate: async (req, res) => {
    try {
      const { Student } = req.models;

      const classGroup = String(req.body.classGroup || "").trim();
      const sectionId = String(req.body.sectionId || "").trim();
      const streamId = String(req.body.streamId || "").trim();
      const academicYear = normalizeAY(req.body.academicYear);
      const termFrom = clampInt(req.body.termFrom, 1, 3, 1);
      const termTo = clampInt(req.body.termTo, 1, 3, 3);

      if (!isObjId(classGroup)) {
        req.flash?.("error", "Class is required.");
        return res.redirect("/admin/transcripts");
      }

      const scope = await resolveAcademicScope(req, { classId: classGroup, sectionId, streamId });
      if (scope.errors.length) {
        req.flash?.("error", scope.errors[0]);
        return res.redirect("/admin/transcripts");
      }

      const resolvedClassId = String(scope.payload.classId || classGroup);
      const studentFilter = { $or: [{ classId: resolvedClassId }, { classGroup: resolvedClassId }] };
      if (scope.payload.sectionId) studentFilter.sectionId = scope.payload.sectionId;
      if (scope.payload.streamId) studentFilter.streamId = scope.payload.streamId;

      const students = await Student.find(studentFilter)
        .select("_id classId sectionId streamId")
        .lean();

      if (!students.length) {
        req.flash?.("error", "No learners found in selected class.");
        return res.redirect("/admin/transcripts");
      }

      let created = 0;
      let failed = 0;

      for (const s of students) {
        const out = await generateOne(req, {
          student: String(s._id),
          classGroup: scope.payload.classId || classGroup,
          sectionId: scope.payload.sectionId || "",
          streamId: scope.payload.streamId || "",
          kind: req.body.kind || "official",
          rangeMode: academicYear ? "custom" : (req.body.rangeMode || "auto"),
          academicYearFrom: academicYear,
          academicYearTo: academicYear,
          termFrom,
          termTo,
          includeDraftResults: req.body.includeDraftResults,
          notes: req.body.notes || "",
          teacherComment: "",
          headTeacherComment: "",
        });

        if (out.ok) created += 1;
        else failed += 1;
      }

      req.flash?.("success", `Bulk generation complete. Generated ${created}, failed ${failed}.`);
      return res.redirect("/admin/transcripts");
    } catch (err) {
      console.error("BULK GENERATE TRANSCRIPTS ERROR:", err);
      req.flash?.("error", "Bulk generation failed.");
      return res.redirect("/admin/transcripts");
    }
  },

  clone: async (req, res) => {
    try {
      const { Transcript } = req.models;
      const id = String(req.params.id || "").trim();

      if (!isObjId(id)) {
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
        classGroup: t.classGroup || null,
        classGroupName: t.classGroupName || "",
        sectionId: t.sectionId || null,
        sectionName: t.sectionName || "",
        sectionCode: t.sectionCode || "",
        streamId: t.streamId || null,
        streamName: t.streamName || "",
        streamCode: t.streamCode || "",
        kind: t.kind || "official",
        rangeMode: t.rangeMode || "auto",
        academicYearFrom: t.academicYearFrom || "",
        academicYearTo: t.academicYearTo || "",
        termFrom: t.termFrom ?? 1,
        termTo: t.termTo ?? 3,
        includeDraftResults: !!t.includeDraftResults,
        autoGenerated: !!t.autoGenerated,
        notes: `Cloned from ${t.issueNumber || t._id}. ${t.notes || ""}`.trim(),
        teacherComment: t.teacherComment || "",
        headTeacherComment: t.headTeacherComment || "",
        status: "draft",
        createdBy: req.user?._id || null,
      });

      await generateOne(req, copy.toObject(), copy._id);

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

      if (!isObjId(id)) {
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
      if (!live || !live.terms?.length) {
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
            generatedAt: new Date(),
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
      const reason = safeStr(req.body.reason, 300);

      if (!isObjId(id)) {
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

      if (!isObjId(id)) {
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
        .filter((x) => isObjId(x));

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
          { $set: { status: "revoked", revokedAt: new Date(), revokedBy: req.user?._id || null } }
        );
        req.flash?.("success", "Selected transcripts revoked.");
      } else if (action === "issue") {
        let issued = 0;
        for (const id of ids) {
          const tdoc = await Transcript.findById(id).lean();
          if (!tdoc || tdoc.status === "issued") continue;

          const live = await buildTranscriptLive(req, tdoc);
          if (!live || !live.terms?.length) continue;

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
                snapshotHash: hashSnapshot(snapshot),
              },
            }
          );
          issued += 1;
        }
        req.flash?.("success", `Issued ${issued} transcript(s).`);
      } else if (action === "regenerate") {
        let regenerated = 0;
        for (const id of ids) {
          const tdoc = await Transcript.findById(id).lean();
          if (!tdoc || tdoc.status === "issued") continue;
          const out = await generateOne(req, tdoc, id);
          if (out.ok) regenerated += 1;
        }
        req.flash?.("success", `Regenerated ${regenerated} transcript(s).`);
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

      if (!isObjId(id)) return res.status(404).send("Not found.");

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

      return res.render("tenant/transcripts/print", {
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
          classGroup: tdoc.snapshot?.student?.classGroup || "—",
          average: tdoc.snapshot?.totals?.average ?? 0,
          overallGrade: tdoc.snapshot?.totals?.overallGrade || "—",
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
