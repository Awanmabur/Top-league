const mongoose = require("mongoose");
const QRCode = require("qrcode");
const { body, validationResult } = require("express-validator");
const { loadAcademicScopeLists, buildAcademicScopeFilter, resolveAcademicScope } = require("../../../utils/tenantAcademicScope");
const { defaultGrading, escapeRegExp } = require("../../../services/tenant/resultService");
const {
  normalizeKind,
  normalizeRangeMode,
  normalizeRange,
  compareAcademicPoint,
  resultWithinRange,
  transcriptResultStatusFilter,
  assertTranscriptEditable,
  assertTranscriptDeleteAllowed,
  assertTranscriptIssueAllowed,
  assertTranscriptRevokeAllowed,
  hashSnapshot,
  snapshotIntegrityOk,
  assertSigningConfigured,
  verificationSignature,
  verifyTranscriptCredential,
  newIssueNumber,
  transcriptDisplaySnapshot,
} = require("../../../services/tenant/transcriptService");

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

function buildVerifyUrl(issueNumber, sig) {
  const base = String(process.env.APP_PUBLIC_URL || "").replace(/\/$/, "") || "";
  return `${base}/verify/transcript/${encodeURIComponent(issueNumber)}?sig=${encodeURIComponent(sig || "")}`;
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
  const rows = await Result.find({ student: studentId, status: statusFilter, migrationQuarantinedAt: null, ...scopeFilter })
    .select("academicYear term")
    .lean();
  const normalized = rows
    .map((r) => ({ academicYear: normalizeAY(r.academicYear), term: clampInt(r.term, 1, 3, 1) }))
    .filter((r) => r.academicYear)
    .sort((a, b) => compareAcademicPoint(a.academicYear, a.term, b.academicYear, b.term));
  if (!normalized.length) return { academicYearFrom: "", academicYearTo: "", termFrom: 1, termTo: 3, found: false };
  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  return {
    academicYearFrom: first.academicYear,
    academicYearTo: last.academicYear,
    termFrom: first.term,
    termTo: last.term,
    found: true,
  };
}

async function getCurrentRange(req, studentId, includeDraft, scopeFilter = {}) {
  const all = await getRangeFromResults(req, studentId, includeDraft, scopeFilter);
  if (!all.found) return { academicYearFrom: "", academicYearTo: "", termFrom: 1, termTo: 1, found: false };
  return {
    academicYearFrom: all.academicYearTo,
    academicYearTo: all.academicYearTo,
    termFrom: all.termTo,
    termTo: all.termTo,
    found: true,
  };
}

async function resolveRange(req, transcriptDoc, options = {}) {
  const rangeMode = String(transcriptDoc.rangeMode || "auto").trim();
  const includeDraft = transcriptResultStatusFilter(transcriptDoc, { issuing: options.issuing === true }) !== "published";
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

  return { ...normalizeRange({
    academicYearFrom: normalizeAY(transcriptDoc.academicYearFrom),
    academicYearTo: normalizeAY(transcriptDoc.academicYearTo),
    termFrom: clampInt(transcriptDoc.termFrom, 1, 3, 1),
    termTo: clampInt(transcriptDoc.termTo, 1, 3, 3),
  }), found: true };
}

async function buildTranscriptLive(req, transcriptDoc, options = {}) {
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

  const statusFilter = transcriptResultStatusFilter(t, { issuing: options.issuing === true });
  const includeDraft = statusFilter !== "published";
  const range = await resolveRange(req, t, options);
  const scopeFilter = transcriptScopeFilter(t);

  const results = await Result.find({
    student: student._id,
    status: statusFilter,
    migrationQuarantinedAt: null,
    ...scopeFilter,
  })
    .populate("subject", "title code shortTitle")
    .populate("exam", "title code status maxMarks passMark")
    .sort({ academicYear: 1, term: 1, createdAt: 1 })
    .lean();

  const filtered = results.filter((r) => resultWithinRange(r, range));

  const attendanceRows = Attendance
    ? await Attendance.find({
        student: student._id,
        isDeleted: { $ne: true },
        ...scopeFilter,
        migrationQuarantinedAt: null,
      }).select("status academicYear term").lean()
    : [];
  const attendanceInRange = attendanceRows.filter((row) => resultWithinRange(row, range));

  const attendanceSummary = {
    present: attendanceInRange.filter((x) => x.status === "present").length,
    absent: attendanceInRange.filter((x) => x.status === "absent").length,
    late: attendanceInRange.filter((x) => x.status === "late").length,
    excused: attendanceInRange.filter((x) => x.status === "excused").length,
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
    .sort((a, b) => compareAcademicPoint(a.academicYear, a.term, b.academicYear, b.term))
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
    sourceResults: filtered.map((r) => ({
      id: String(r._id || ""),
      status: r.status || "",
      revision: Number(r.revision || 0),
      publishedAt: r.publishedAt || null,
      exam: String(r.exam?._id || r.exam || ""),
      subject: String(r.subject?._id || r.subject || ""),
    })),
    terms,
  };
}

async function generateOne(req, payload, existingId = null) {
  const { Transcript, Student } = req.models;

  const scope = await resolveAcademicScope(req, {
    classId: payload.classGroup || payload.classId || "",
    sectionId: payload.sectionId || "",
    streamId: payload.streamId || "",
  });

  if (scope.errors.length) return { ok: false, id: existingId || null, reason: scope.errors[0] };

  const student = await Student.findById(payload.student)
    .select("_id isDeleted status")
    .lean();
  if (!student || student.isDeleted === true || String(student.status || "").toLowerCase() === "archived") {
    return { ok: false, id: existingId || null, reason: "Learner is not available for transcript generation." };
  }

  if (existingId) {
    const existing = await Transcript.findById(existingId).lean();
    if (!existing) return { ok: false, id: existingId, reason: "Transcript not found." };
    try { assertTranscriptEditable(existing); }
    catch (err) { return { ok: false, id: existingId, reason: err.message }; }
  }

  const kind = normalizeKind(payload.kind || "official");
  const rangeMode = normalizeRangeMode(payload.rangeMode || "auto");
  const requestedIncludeDraft = String(payload.includeDraftResults || "0") === "1" || payload.includeDraftResults === true;
  const manualRange = normalizeRange({
    academicYearFrom: normalizeAY(payload.academicYearFrom),
    academicYearTo: normalizeAY(payload.academicYearTo),
    termFrom: clampInt(payload.termFrom, 1, 3, 1),
    termTo: clampInt(payload.termTo, 1, 3, 3),
  });

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
    kind,
    rangeMode,
    ...manualRange,
    includeDraftResults: kind === "unofficial" && requestedIncludeDraft,
    notes: safeStr(payload.notes, 1000),
    teacherComment: safeStr(payload.teacherComment, 1000),
    headTeacherComment: safeStr(payload.headTeacherComment, 1000),
    autoGenerated: true,
    status: "draft",
    issueNumber: "",
    issuedAt: null,
    issuedBy: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: "",
    verificationVersion: 2,
    migrationQuarantinedAt: null,
    migrationQuarantineReason: "",
    generatedAt: new Date(),
    updatedBy: req.user?._id || null,
  };

  // Preflight before persistence so invalid ranges/no-result requests do not leave empty drafts behind.
  const live = await buildTranscriptLive(req, { ...base, _id: existingId || null });
  if (!live || !live.terms?.length) return { ok: false, id: existingId || null, reason: "No results found for selected range." };

  let tdoc;
  if (existingId) {
    const write = await Transcript.updateOne({ _id: existingId, status: "draft", migrationQuarantinedAt: null }, { $set: base });
    if (!write.matchedCount) return { ok: false, id: existingId, reason: "Transcript changed while you were editing it. Reload and try again." };
    tdoc = await Transcript.findById(existingId).lean();
  } else {
    const created = await Transcript.create({ ...base, createdBy: req.user?._id || null });
    tdoc = created.toObject();
  }

  live.transcriptMeta._id = tdoc._id;
  const snapshotHash = hashSnapshot(live);
  await Transcript.updateOne(
    { _id: tdoc._id, status: "draft" },
    { $set: { snapshot: live, snapshotHash, generatedAt: new Date(), verificationVersion: 2 } }
  );

  return { ok: true, id: tdoc._id, live };
}

async function issueOne(req, transcriptDoc) {
  const { Transcript } = req.models;
  assertSigningConfigured();
  assertTranscriptEditable(transcriptDoc);

  const live = await buildTranscriptLive(req, { ...transcriptDoc, includeDraftResults: false }, { issuing: true });
  assertTranscriptIssueAllowed({ ...transcriptDoc, includeDraftResults: false }, live);

  const issuedAt = new Date();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const issueNumber = newIssueNumber(issuedAt);
    const snapshot = {
      ...live,
      transcriptMeta: {
        ...live.transcriptMeta,
        status: "issued",
        issueNumber,
        issuedAt,
        issuedBy: req.user?._id || null,
        includeDraftResults: false,
      },
    };
    const snapshotHash = hashSnapshot(snapshot);
    try {
      const write = await Transcript.updateOne(
        { _id: transcriptDoc._id, status: "draft", migrationQuarantinedAt: null },
        { $set: {
          status: "issued",
          includeDraftResults: false,
          issueNumber,
          issuedAt,
          issuedBy: req.user?._id || null,
          revokedAt: null,
          revokedBy: null,
          revokeReason: "",
          snapshot,
          snapshotHash,
          verificationVersion: 2,
          generatedAt: new Date(),
          updatedBy: req.user?._id || null,
        } }
      );
      if (!write.matchedCount) throw new Error("Transcript changed before it could be issued. Reload and try again.");
      return { ok: true, issueNumber, issuedAt, snapshot, snapshotHash };
    } catch (err) {
      if (err?.code === 11000 && attempt < 4) continue;
      throw err;
    }
  }
  throw new Error("Could not allocate a unique transcript issue number.");
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

      const filter = { migrationQuarantinedAt: null };
      if (status && ["draft", "issued", "revoked"].includes(status)) filter.status = status;
      if (kind && ["official", "unofficial"].includes(kind)) filter.kind = kind;
      Object.assign(filter, buildAcademicScopeFilter({ classGroup, sectionId, streamId }));

      if (q) {
        const rx = escapeRegExp(q);
        const students = await Student.find({
          isDeleted: { $ne: true },
          $or: [
            { fullName: { $regex: rx, $options: "i" } },
            { name: { $regex: rx, $options: "i" } },
            { regNo: { $regex: rx, $options: "i" } },
            { studentNo: { $regex: rx, $options: "i" } },
            { indexNumber: { $regex: rx, $options: "i" } },
          ],
        })
          .select("_id")
          .limit(1000)
          .lean();

        filter.student = students.length ? { $in: students.map((s) => s._id) } : "__none__";
      }

      const kpiFilter = { ...filter };
      delete kpiFilter.status;

      // Launch independent transcript/catalog reads together. These used to form a
      // long serial waterfall on every Admin Transcripts page request.
      const [total, statusRows, scopeLists, studentsList, classes] = await Promise.all([
        Transcript.countDocuments(filter),
        Transcript.aggregate([
          { $match: kpiFilter },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        loadAcademicScopeLists(req, { includeStudents: true }),
        Student.find({ isDeleted: { $ne: true }, status: { $ne: "archived" } })
          .select("fullName firstName middleName lastName regNo studentNo indexNumber name classId className sectionId section streamId stream")
          .sort({ fullName: 1, firstName: 1, lastName: 1 })
          .limit(4000)
          .lean(),
        Class.find({})
          .select("name code")
          .sort({ name: 1 })
          .lean(),
      ]);

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

      const statusCounts = Object.fromEntries(
        statusRows.map((row) => [String(row._id || ""), Number(row.count || 0)])
      );

      let preview = null;
      let previewId = null;

      if (tid && isObjId(tid)) previewId = tid;
      else if (transcripts[0]?._id) previewId = String(transcripts[0]._id);

      if (previewId) {
        const tdoc = await Transcript.findById(previewId).lean();
        if (tdoc) {
          preview = ["issued", "revoked"].includes(tdoc.status) && tdoc.snapshot
            ? transcriptDisplaySnapshot(tdoc)
            : await buildTranscriptLive(req, tdoc);
        }
      }

      const kpis = {
        total,
        draft: statusCounts.draft || 0,
        issued: statusCounts.issued || 0,
        revoked: statusCounts.revoked || 0,
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
      const out = await generateOne(req, {
        student: t.student,
        classGroup: t.classGroup || null,
        sectionId: t.sectionId || null,
        streamId: t.streamId || null,
        kind: t.kind || "official",
        rangeMode: t.rangeMode || "auto",
        academicYearFrom: t.academicYearFrom || "",
        academicYearTo: t.academicYearTo || "",
        termFrom: t.termFrom ?? 1,
        termTo: t.termTo ?? 3,
        includeDraftResults: t.kind === "unofficial" ? !!t.includeDraftResults : false,
        notes: `Cloned from ${t.issueNumber || t._id}. ${t.notes || ""}`.trim(),
        teacherComment: t.teacherComment || "",
        headTeacherComment: t.headTeacherComment || "",
      });
      if (!out.ok) throw new Error(out.reason || "Failed to clone transcript.");
      req.flash?.("success", "Transcript cloned as draft.");
      return res.redirect(`/admin/transcripts?tid=${encodeURIComponent(out.id)}`);
    } catch (err) {
      console.error("CLONE TRANSCRIPT ERROR:", err);
      req.flash?.("error", err?.message || "Failed to clone transcript.");
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
      const out = await issueOne(req, tdoc);
      req.flash?.("success", `Transcript issued (${out.issueNumber}).`);
      return res.redirect(`/admin/transcripts?tid=${encodeURIComponent(id)}`);
    } catch (err) {
      console.error("ISSUE TRANSCRIPT ERROR:", err);
      req.flash?.("error", err?.message || "Failed to issue transcript.");
      return res.redirect("/admin/transcripts");
    }
  },

  revoke: async (req, res) => {
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
      const reason = assertTranscriptRevokeAllowed(tdoc, req.body.reason);
      const write = await Transcript.updateOne(
        { _id: id, status: "issued", migrationQuarantinedAt: null },
        { $set: { status: "revoked", revokedAt: new Date(), revokedBy: req.user?._id || null, revokeReason: reason, updatedBy: req.user?._id || null } }
      );
      if (!write.matchedCount) throw new Error("Transcript changed before it could be revoked. Reload and try again.");
      req.flash?.("success", "Transcript revoked.");
      return res.redirect(`/admin/transcripts?tid=${encodeURIComponent(id)}`);
    } catch (err) {
      console.error("REVOKE TRANSCRIPT ERROR:", err);
      req.flash?.("error", err?.message || "Failed to revoke transcript.");
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
      const tdoc = await Transcript.findById(id).lean();
      if (!tdoc) {
        req.flash?.("error", "Transcript not found.");
        return res.redirect("/admin/transcripts");
      }
      assertTranscriptDeleteAllowed(tdoc);
      const write = await Transcript.deleteOne({ _id: id, status: "draft", migrationQuarantinedAt: null });
      if (!write.deletedCount) throw new Error("Transcript changed before it could be deleted. Reload and try again.");
      req.flash?.("success", "Transcript deleted.");
      return res.redirect("/admin/transcripts");
    } catch (err) {
      console.error("DELETE TRANSCRIPT ERROR:", err);
      req.flash?.("error", err?.message || "Failed to delete transcript.");
      return res.redirect("/admin/transcripts");
    }
  },

  bulk: async (req, res) => {
    try {
      const { Transcript } = req.models;
      const action = safeStr(req.body.action, 20);
      const ids = [...new Set(String(req.body.ids || "").split(",").map((x) => x.trim()).filter((x) => isObjId(x)))];
      if (!ids.length) {
        req.flash?.("error", "No transcripts selected.");
        return res.redirect("/admin/transcripts");
      }

      const docs = await Transcript.find({ _id: { $in: ids } }).lean();
      if (docs.length !== ids.length) throw new Error("One or more selected transcripts no longer exist.");

      let completed = 0;
      if (action === "delete") {
        for (const doc of docs) assertTranscriptDeleteAllowed(doc);
        for (const doc of docs) {
          const write = await Transcript.deleteOne({ _id: doc._id, status: "draft", migrationQuarantinedAt: null });
          if (!write.deletedCount) throw new Error("A selected transcript changed during bulk delete. Reload and try again.");
          completed += 1;
        }
      } else if (action === "revoke") {
        const reason = assertTranscriptRevokeAllowed(docs[0], req.body.reason || "Bulk administrative revocation");
        for (const doc of docs) assertTranscriptRevokeAllowed(doc, reason);
        for (const doc of docs) {
          const write = await Transcript.updateOne(
            { _id: doc._id, status: "issued", migrationQuarantinedAt: null },
            { $set: { status: "revoked", revokedAt: new Date(), revokedBy: req.user?._id || null, revokeReason: reason, updatedBy: req.user?._id || null } }
          );
          if (!write.matchedCount) throw new Error("A selected transcript changed during bulk revoke. Reload and try again.");
          completed += 1;
        }
      } else if (action === "issue") {
        assertSigningConfigured();
        for (const doc of docs) assertTranscriptEditable(doc);
        for (const doc of docs) {
          await issueOne(req, doc);
          completed += 1;
        }
      } else if (action === "regenerate") {
        for (const doc of docs) assertTranscriptEditable(doc);
        for (const doc of docs) {
          const out = await generateOne(req, doc, doc._id);
          if (!out.ok) throw new Error(out.reason || "A selected transcript could not be regenerated.");
          completed += 1;
        }
      } else {
        throw new Error("Invalid bulk action.");
      }

      req.flash?.("success", `${action[0].toUpperCase() + action.slice(1)} completed for ${completed} transcript(s).`);
      return res.redirect("/admin/transcripts");
    } catch (err) {
      console.error("TRANSCRIPT BULK ERROR:", err);
      req.flash?.("error", err?.message || "Bulk action failed.");
      return res.redirect("/admin/transcripts");
    }
  },

  printView: async (req, res) => {
    try {
      const { Transcript } = req.models;
      const id = String(req.params.id || "").trim();
      if (!isObjId(id)) return res.status(404).send("Not found.");
      const tdoc = await Transcript.findById(id).lean();
      if (!tdoc || tdoc.migrationQuarantinedAt) return res.status(404).send("Not found.");

      const immutable = ["issued", "revoked"].includes(tdoc.status);
      if (immutable && !snapshotIntegrityOk(tdoc)) return res.status(409).send("Transcript snapshot integrity check failed.");
      const data = immutable ? transcriptDisplaySnapshot(tdoc) : await buildTranscriptLive(req, tdoc);
      if (!data) return res.status(404).send("Not found.");
      data.snapshotHash = tdoc.snapshotHash || "";

      let qrDataUrl = "";
      let verifyUrl = "";
      if (immutable && tdoc.issueNumber && tdoc.issuedAt) {
        const sig = verificationSignature(tdoc);
        if (sig) {
          verifyUrl = buildVerifyUrl(tdoc.issueNumber, sig);
          qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 240 });
        }
      }

      return res.render("tenant/transcripts/print", { tenant: req.tenant || null, data, qrDataUrl, verifyUrl });
    } catch (err) {
      console.error("PRINT TRANSCRIPT ERROR:", err);
      return res.status(500).send("Failed to render transcript.");
    }
  },

  verifyPage: async (req, res) => {
    try {
      const { Transcript } = req.models;
      const issueNumber = safeStr(req.params.issueNumber, 80);
      const sig = safeStr(req.query.sig, 256);
      const tdoc = await Transcript.findOne({ issueNumber, migrationQuarantinedAt: null }).lean();
      let ok = false;
      let reason = "Transcript not found.";
      let minimal = null;
      if (tdoc) {
        const verdict = verifyTranscriptCredential(tdoc, sig);
        ok = verdict.ok;
        reason = verdict.ok ? "" : verdict.reason;
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
      return res.render("tenant/transcripts/verify-transcript", { ok, reason, minimal });
    } catch (err) {
      console.error("VERIFY TRANSCRIPT ERROR:", err);
      return res.status(500).send("Verification failed.");
    }
  },

  verifyApi: async (req, res) => {
    try {
      const { Transcript } = req.models;
      const issueNumber = safeStr(req.params.issueNumber, 80);
      const sig = safeStr(req.query.sig, 256);
      const tdoc = await Transcript.findOne({ issueNumber, migrationQuarantinedAt: null }).lean();
      if (!tdoc) return res.status(404).json({ ok: false, reason: "Not found" });
      const verdict = verifyTranscriptCredential(tdoc, sig);
      if (!verdict.ok) {
        const statusCode = verdict.serverError ? 500 : (verdict.revoked ? 200 : 401);
        return res.status(statusCode).json({
          ok: false,
          reason: verdict.reason,
          status: tdoc.status,
          revokedAt: tdoc.revokedAt || null,
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
