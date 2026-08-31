const mongoose = require("mongoose");
const QRCode = require("qrcode");
const { getParent, canAccessChild } = require("./_helpers");
const { studentPublishedResultFilter } = require("../../../services/tenant/resultService");
const { snapshotIntegrityOk, transcriptDisplaySnapshot, verificationSignature } = require("../../../services/tenant/transcriptService");


const isObjId = (v) => mongoose.Types.ObjectId.isValid(String(v || "").trim());
function buildVerifyUrl(issueNumber, sig) {
  const base = String(process.env.APP_PUBLIC_URL || "").replace(/\/$/, "") || "";
  return `${base}/verify/transcript/${encodeURIComponent(issueNumber)}?sig=${encodeURIComponent(sig || "")}`;
}

async function latestValidOfficialTranscript(Transcript, studentId) {
  const docs = await Transcript.find({ student: studentId, status: "issued", kind: "official", migrationQuarantinedAt: null })
    .sort({ issuedAt: -1, createdAt: -1 }).limit(10).lean();
  return docs.find((doc) => snapshotIntegrityOk(doc)) || null;
}
function normalizeRow(r = {}) {
  const exam = r.exam || {};
  const subject = r.subject || {};
  const totalMarks = Number(r.totalMarks || exam.maxMarks || 100);
  const rawScore = Number(r.score || 0);
  const percentage = Number.isFinite(Number(r.percentage))
    ? Number(r.percentage)
    : totalMarks > 0
      ? Math.round((rawScore / totalMarks) * 10000) / 100
      : 0;
  const passMarkRaw = Number.isFinite(Number(r.passMark)) ? Number(r.passMark) : Number(exam.passMark || 50);
  const passMark = totalMarks > 0 ? Math.round((passMarkRaw / totalMarks) * 10000) / 100 : 50;
  return {
    id: String(r._id || ""),
    subject: subject.title || subject.shortTitle || "Subject",
    subjectName: subject.title || subject.shortTitle || "Subject",
    subjectCode: subject.code || "",
    exam: exam.title || "Exam",
    examTitle: exam.title || "Exam",
    academicYear: r.academicYear || "",
    term: Number(r.term || 1),
    score: percentage,
    totalScore: percentage,
    rawScore,
    totalMarks,
    passMark,
    grade: r.grade || "—",
    remarks: r.remark || "—",
    remark: r.remark || "—",
    publishedAt: r.publishedAt || null,
    createdAt: r.createdAt || null,
  };
}

function buildTermSummary(rows = []) {
  const total = rows.length;
  if (!total) {
    return { totalSubjects: 0, averageScore: 0, passed: 0, failed: 0, bestSubject: null, weakestSubject: null, rows: [] };
  }
  const totalScore = rows.reduce((sum, r) => sum + Number(r.score || 0), 0);
  const averageScore = Math.round((totalScore / rows.length) * 100) / 100;
  const passed = rows.filter((r) => Number(r.score) >= Number(r.passMark || 50)).length;
  const sorted = [...rows].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  return {
    totalSubjects: rows.length,
    averageScore,
    passed,
    failed: rows.length - passed,
    bestSubject: sorted[0] || null,
    weakestSubject: sorted[sorted.length - 1] || null,
    rows,
  };
}

function buildRecentPerformance(rows = []) {
  return rows.slice(0, 8).map((r) => ({
    exam: r.examTitle || "Exam",
    subject: r.subjectCode ? `${r.subjectCode} — ${r.subject}` : r.subject,
    score: Number(r.score || 0),
    grade: r.grade || "—",
    date: r.publishedAt ? new Date(r.publishedAt).toLocaleDateString() : "—",
    remarks: r.remarks || "—",
  }));
}

module.exports = {
  async index(req, res) {
    try {
      const { Student, Result, Exam, Subject, Transcript } = req.models || {};
      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");

      const childIds = Array.isArray(parent?.childrenStudentIds) ? parent.childrenStudentIds : [];
      const children = parent && Student && childIds.length
        ? await Student.find({ _id: { $in: childIds }, isDeleted: { $ne: true }, status: { $ne: 'archived' } })
            .select("firstName lastName middleName fullName regNo studentNo classId className classCode classLevel academicYear term status")
            .sort({ firstName: 1, lastName: 1, fullName: 1 })
            .lean()
        : [];

      const selectedStudentId = req.query?.student ? String(req.query.student) : "";
      let student = selectedStudentId && canAccessChild(parent, selectedStudentId)
        ? children.find((c) => String(c._id) === selectedStudentId) || null
        : null;
      if (!student && children.length) student = children[0];

      const academicYearFilter = String(req.query?.academicYear || "").trim();
      const termFilter = String(req.query?.term || "").trim();
      if (!student) {
        return res.render("parents/results", {
          tenant: req.tenant, user, parent, children, student: null,
          resultRows: [], recentPerformance: [], officialTranscript: null,
          resultSummary: buildTermSummary([]),
          filters: { academicYear: academicYearFilter, term: termFilter },
          options: { academicYears: [], terms: [] },
          error: "No linked student found for this parent account.",
        });
      }

      const extra = {};
      if (academicYearFilter) extra.academicYear = academicYearFilter;
      if (termFilter && [1, 2, 3].includes(Number(termFilter))) extra.term = Number(termFilter);
      let query = Result.find(studentPublishedResultFilter(student._id, extra));
      if (Exam) query = query.populate({ path: "exam", model: Exam, select: "title code maxMarks passMark status" });
      if (Subject) query = query.populate({ path: "subject", model: Subject, select: "code title shortTitle" });
      const docs = await query.sort({ academicYear: -1, term: -1, publishedAt: -1, createdAt: -1 }).lean();
      const resultRows = docs.map(normalizeRow);
      const resultSummary = buildTermSummary(resultRows);
      const recentPerformance = buildRecentPerformance(resultRows);
      const officialDoc = await latestValidOfficialTranscript(Transcript, student._id);
      const officialTranscript = officialDoc ? {
        id: String(officialDoc._id), issueNumber: officialDoc.issueNumber, issuedAt: officialDoc.issuedAt,
      } : null;

      const allMeta = await Result.find(studentPublishedResultFilter(student._id))
        .select("academicYear term")
        .sort({ academicYear: -1, term: -1 })
        .lean();
      const availableAcademicYears = [...new Set(allMeta.map((r) => String(r.academicYear || "").trim()).filter(Boolean))];
      const availableTerms = [...new Set(allMeta.map((r) => Number(r.term || 0)).filter((n) => [1, 2, 3].includes(n)))];

      return res.render("parents/results", {
        tenant: req.tenant, user, parent, children, student,
        resultRows, recentPerformance, resultSummary, officialTranscript,
        filters: { academicYear: academicYearFilter, term: termFilter },
        options: { academicYears: availableAcademicYears, terms: availableTerms },
        error: null,
      });
    } catch (err) {
      console.error("PARENT RESULTS ERROR:", err);
      return res.status(500).send("Failed to load parent results page");
    }
  },
  async printTranscript(req, res) {
    try {
      const { Transcript } = req.models || {};
      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");
      const studentId = String(req.params.studentId || "");
      const transcriptId = String(req.params.id || "");
      if (!isObjId(studentId) || !isObjId(transcriptId) || !canAccessChild(parent, studentId)) return res.status(404).send("Not found.");
      const tdoc = await Transcript.findOne({
        _id: transcriptId, student: studentId, status: "issued", kind: "official", migrationQuarantinedAt: null,
      }).lean();
      if (!tdoc) return res.status(404).send("Not found.");
      if (!snapshotIntegrityOk(tdoc)) return res.status(409).send("Transcript snapshot integrity check failed.");
      const data = transcriptDisplaySnapshot(tdoc);
      data.snapshotHash = tdoc.snapshotHash || "";
      const sig = verificationSignature(tdoc);
      const verifyUrl = sig ? buildVerifyUrl(tdoc.issueNumber, sig) : "";
      const qrDataUrl = verifyUrl ? await QRCode.toDataURL(verifyUrl, { margin: 1, width: 240 }) : "";
      return res.render("tenant/transcripts/print", { tenant: req.tenant || null, data, qrDataUrl, verifyUrl });
    } catch (err) {
      console.error("PARENT PRINT TRANSCRIPT ERROR:", err);
      return res.status(500).send("Failed to render transcript.");
    }
  },
  _test: { normalizeRow, buildTermSummary, buildRecentPerformance, latestValidOfficialTranscript },
};
