const { verifyLetterCredential } = require("../../../services/tenant/studentSelfServiceService");

async function lookup(req) {
  const requestNumber = String(req.params.requestNumber || "").trim().toUpperCase();
  const signature = String(req.query.sig || "").trim().toLowerCase();
  const letter = await req.models.LetterRequest.findOne({ requestNumber, status: { $in: ["Ready", "Collected"] }, isDeleted: { $ne: true } })
    .populate("studentId", "firstName lastName fullName regNo studentNo classLevel").lean();
  if (!letter) return { ok: false, reason: "Letter not found or not issued.", minimal: null };
  const verification = verifyLetterCredential(letter, signature);
  const student = letter.studentId || {};
  const snap = letter.issuedSnapshot || {};
  return {
    ok: verification.ok,
    reason: verification.reason || "",
    serverError: verification.serverError === true,
    minimal: verification.ok ? {
      requestNumber: letter.requestNumber, type: letter.type, status: letter.status,
      studentName: snap.studentName || student.fullName || [student.firstName, student.lastName].filter(Boolean).join(" ") || "Student",
      studentNumber: snap.registrationNumber || student.regNo || student.studentNo || "", classLevel: snap.classLevel || student.classLevel || "",
      academicYear: snap.academicYear || letter.academicYear, term: snap.term || letter.term, readyAt: letter.readyAt,
    } : null,
  };
}

module.exports = {
  page: async (req, res) => {
    try { const result = await lookup(req); return res.status(result.serverError ? 503 : 200).render("tenant/transcripts/verify-letter", { tenant: req.tenant || null, ...result }); }
    catch (err) { console.error("LETTER VERIFY ERROR:", err); return res.status(500).send("Verification unavailable."); }
  },
  api: async (req, res) => {
    try { const result = await lookup(req); return res.status(result.serverError ? 503 : result.ok ? 200 : 404).json(result); }
    catch (_) { return res.status(500).json({ ok: false, reason: "Verification unavailable." }); }
  },
  _test: { lookup },
};
