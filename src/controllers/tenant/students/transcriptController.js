const mongoose = require("mongoose");
const QRCode = require("qrcode");
const {
  getStudent,
  mustHaveStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
} = require("./_helpers");
const { studentPublishedResultFilter } = require("../../../services/tenant/resultService");
const {
  summarizePublishedResults,
  snapshotIntegrityOk,
  transcriptDisplaySnapshot,
  verificationSignature,
} = require("../../../services/tenant/transcriptService");
const {
  createLetterRequest,
  cancelLetterRequest,
  signLetterCredential,
} = require("../../../services/tenant/studentSelfServiceService");

const isObjId = (v) => mongoose.Types.ObjectId.isValid(String(v || "").trim());

function publicBase(req) {
  const configured = String(process.env.APP_PUBLIC_URL || "").replace(/\/$/, "");
  if (configured) return configured;
  const protocol = req?.protocol === "https" ? "https" : "http";
  const host = String(req?.get?.("host") || "");
  return host ? `${protocol}://${host}` : "";
}
function buildVerifyUrl(issueNumber, sig, req = null) {
  return `${publicBase(req)}/verify/transcript/${encodeURIComponent(issueNumber)}?sig=${encodeURIComponent(sig || "")}`;
}
function buildLetterVerifyUrl(letter, sig, req = null) {
  return `${publicBase(req)}/verify/letter/${encodeURIComponent(letter.requestNumber)}?sig=${encodeURIComponent(sig || "")}`;
}

async function latestValidOfficialTranscript(Transcript, studentId) {
  const docs = await Transcript.find({
    student: studentId,
    status: "issued",
    kind: "official",
    migrationQuarantinedAt: null,
  }).sort({ issuedAt: -1, createdAt: -1 }).limit(10).lean();
  return docs.find((doc) => snapshotIntegrityOk(doc)) || null;
}

async function pageContext(req, res) {
  if (!req.models) return { response: res.status(500).send("Tenant models not loaded") };
  const { Transcript, Result, LetterRequest, Invoice } = req.models;
  const got = await getStudent(req);
  const user = got?.user || null;
  const student = got?.student || null;
  if (!user) return { response: res.redirect("/login") };
  const blocked = mustHaveStudent(res, {
    tenant: req.tenant, user, student, currentPath: req.originalUrl, pageTitle: "Transcripts & Official Letters",
  }, "students/transcript");
  if (blocked) return { response: blocked };

  const meta = academicMeta(student);
  const latestIssued = await Transcript.findOne({ student: student._id, status: "issued" }).sort({ issuedAt: -1, createdAt: -1 }).lean();
  const officialTranscript = latestIssued && latestIssued.kind === "official" && !latestIssued.migrationQuarantinedAt && snapshotIntegrityOk(latestIssued)
    ? latestIssued : await latestValidOfficialTranscript(Transcript, student._id);
  const results = await Result.find(studentPublishedResultFilter(student._id))
    .populate({ path: "subject", select: "code title shortTitle" })
    .populate({ path: "exam", select: "title code status maxMarks passMark" })
    .sort({ academicYear: -1, term: -1, publishedAt: -1, createdAt: -1 }).lean();
  const summary = summarizePublishedResults(results);
  const letterRequests = await LetterRequest.find({ studentId: student._id, isDeleted: { $ne: true } }).sort({ createdAt: -1 }).lean();
  const openInvoices = await Invoice.find({
    studentId: student._id,
    status: { $in: ["Unpaid", "Partially Paid", "Overdue"] },
    isDeleted: { $ne: true },
  }).select("_id").lean();

  const definitions = [
    { type: "Admission Letter", purpose: "For visa, sponsorship, or official admission proof.", format: "PDF" },
    { type: "Registration Letter", purpose: "Confirms current term registration.", format: "PDF" },
    { type: "Bonafide Student Letter", purpose: "Certifies that you are a bonafide student in good standing.", format: "Digitally signed PDF" },
    { type: "Study Load Confirmation", purpose: "States your current academic load.", format: "PDF" },
  ];
  const lettersCatalogue = definitions.map((item) => {
    const request = letterRequests.find((r) => r.type === item.type && r.academicYear === String(student.academicYear || "") && Number(r.term) === Number(student.term));
    return {
      ...item,
      request: request ? {
        id: String(request._id), requestNumber: request.requestNumber, status: request.status,
        requestedAt: request.requestedAt || request.createdAt,
        canCancel: request.status === "Pending",
        canOpen: ["Ready", "Collected"].includes(request.status),
      } : null,
    };
  });
  return { user, student, meta, summary, officialTranscript, letterRequests, openInvoices, lettersCatalogue };
}

module.exports = {
  transcript: async (req, res) => {
    try {
      const ctx = await pageContext(req, res);
      if (ctx.response) return ctx.response;
      const { user, student, meta, summary, officialTranscript, letterRequests, openInvoices, lettersCatalogue } = ctx;
      return renderView(req, res, "students/transcript", {
        pageTitle: "Transcripts & Official Letters",
        user, student, studentName: getStudentDisplayName(student, user), meta,
        transcriptRows: summary.rows,
        officialTranscript: officialTranscript ? {
          id: String(officialTranscript._id), issueNumber: officialTranscript.issueNumber,
          issuedAt: officialTranscript.issuedAt, snapshotHash: officialTranscript.snapshotHash,
        } : null,
        overview: {
          average: summary.average, latestTermAverage: summary.latestAverage, passed: summary.passed, failed: summary.failed,
          totalSubjects: summary.rows.length, latestAcademicYear: summary.latestAcademicYear, latestTerm: summary.latestTerm,
          overallGrade: summary.overallGrade, overallRemark: summary.overallRemark,
          academicStatus: openInvoices.length ? "Finance hold risk" : "Good standing",
        },
        lettersCatalogue,
        lettersStats: {
          requestedThisYear: letterRequests.filter((r) => r.academicYear === String(student.academicYear || "")).length,
          pending: letterRequests.filter((r) => r.status === "Pending").length,
          maxPerTerm: 5,
        },
      });
    } catch (err) {
      console.error("STUDENT TRANSCRIPT ERROR:", err);
      return res.status(500).send("Failed to load transcript.");
    }
  },

  requestLetter: async (req, res) => {
    try {
      const got = await getStudent(req);
      if (!got?.user) return res.redirect("/login");
      if (!got?.student) return res.status(403).send("Student profile required.");
      await createLetterRequest(req.models, {
        student: got.student, userId: got.user._id, type: req.body?.type, purpose: req.body?.purpose, maxPerTerm: 5,
      });
      req.flash?.("success", "Official letter request submitted.");
    } catch (err) { req.flash?.("error", err.message || "Could not submit letter request."); }
    return res.redirect("/student/transcript");
  },

  cancelLetter: async (req, res) => {
    try {
      const got = await getStudent(req);
      if (!got?.user) return res.redirect("/login");
      if (!got?.student) return res.status(403).send("Student profile required.");
      await cancelLetterRequest(req.models?.LetterRequest, { student: got.student, requestId: req.params.id, userId: got.user._id });
      req.flash?.("success", "Letter request cancelled.");
    } catch (err) { req.flash?.("error", err.message || "Could not cancel letter request."); }
    return res.redirect("/student/transcript");
  },

  printLetter: async (req, res) => {
    try {
      const { LetterRequest } = req.models || {};
      const got = await getStudent(req);
      if (!got?.user) return res.redirect("/login");
      if (!got?.student || !isObjId(req.params.id)) return res.status(404).send("Not found.");
      const letter = await LetterRequest.findOne({
        _id: req.params.id, studentId: got.student._id, status: { $in: ["Ready", "Collected"] }, isDeleted: { $ne: true },
      }).lean();
      if (!letter) return res.status(404).send("Letter not found or not ready.");
      const sig = signLetterCredential(letter);
      if (!sig) return res.status(503).send("Official document signing is not configured.");
      const verifyUrl = buildLetterVerifyUrl(letter, sig, req);
      const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 220 });
      return res.render("students/official-letter", {
        tenant: req.tenant || null, user: got.user, student: got.student,
        studentName: letter.issuedSnapshot?.studentName || getStudentDisplayName(got.student, got.user), letter, verifyUrl, qrDataUrl,
      });
    } catch (err) {
      console.error("STUDENT OFFICIAL LETTER ERROR:", err);
      return res.status(500).send("Failed to render official letter.");
    }
  },

  printOfficial: async (req, res) => {
    try {
      const { Transcript } = req.models || {};
      const got = await getStudent(req);
      const user = got?.user || null;
      const student = got?.student || null;
      if (!user) return res.redirect("/login");
      if (!student || !isObjId(req.params.id)) return res.status(404).send("Not found.");
      const tdoc = await Transcript.findOne({
        _id: req.params.id, student: student._id, status: "issued", kind: "official", migrationQuarantinedAt: null,
      }).lean();
      if (!tdoc) return res.status(404).send("Not found.");
      if (!snapshotIntegrityOk(tdoc)) return res.status(409).send("Transcript snapshot integrity check failed.");
      const data = transcriptDisplaySnapshot(tdoc);
      data.snapshotHash = tdoc.snapshotHash || "";
      const sig = verificationSignature(tdoc);
      const verifyUrl = sig ? buildVerifyUrl(tdoc.issueNumber, sig, req) : "";
      const qrDataUrl = verifyUrl ? await QRCode.toDataURL(verifyUrl, { margin: 1, width: 240 }) : "";
      return res.render("tenant/transcripts/print", { tenant: req.tenant || null, data, qrDataUrl, verifyUrl });
    } catch (err) {
      console.error("STUDENT PRINT TRANSCRIPT ERROR:", err);
      return res.status(500).send("Failed to render transcript.");
    }
  },

  _test: { latestValidOfficialTranscript, buildLetterVerifyUrl, pageContext },
};
