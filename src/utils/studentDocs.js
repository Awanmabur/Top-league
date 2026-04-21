const REQUIRED_STUDENT_DOC_TYPES = ["passport", "id", "transcript"];

const TITLE_BY_TYPE = {
  passport: "Passport Photo",
  id: "National ID / Passport",
  transcript: "Transcript / Results Slip",
  certificate: "Certificate",
  other: "Other Document",
};

const TYPE_ALIASES = new Map([
  ["passport", "passport"],
  ["passportphoto", "passport"],
  ["photo", "passport"],
  ["studentphoto", "passport"],
  ["id", "id"],
  ["iddocument", "id"],
  ["nationalid", "id"],
  ["passportscan", "id"],
  ["passportcopy", "id"],
  ["transcript", "transcript"],
  ["result", "transcript"],
  ["results", "transcript"],
  ["resultslip", "transcript"],
  ["gradeslip", "transcript"],
  ["certificate", "certificate"],
  ["other", "other"],
  ["document", "other"],
]);

function safeStr(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeToken(value) {
  return safeStr(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeStudentDocType(type, title = "") {
  const direct = TYPE_ALIASES.get(normalizeToken(type));
  if (direct) return direct;

  const fromTitle = TYPE_ALIASES.get(normalizeToken(title));
  if (fromTitle) return fromTitle;

  const typeText = `${safeStr(type)} ${safeStr(title)}`.toLowerCase();
  if (/(passport.*photo|photo.*passport)/.test(typeText)) return "passport";
  if (/(national.*id|id.*document|passport.*scan|passport.*copy)/.test(typeText)) return "id";
  if (/(transcript|result.*slip|grade.*slip|results?)/.test(typeText)) return "transcript";
  if (/certificate/.test(typeText)) return "certificate";
  return "other";
}

function titleForStudentDocType(type) {
  return TITLE_BY_TYPE[normalizeStudentDocType(type)] || "Student Document";
}

function normalizeDocShape(doc, fallback = {}) {
  if (!doc || typeof doc !== "object") return null;

  const url = safeStr(doc.url || fallback.url);
  const publicId = safeStr(doc.publicId || fallback.publicId);
  if (!url || !publicId) return null;

  return {
    url,
    publicId,
    resourceType: safeStr(doc.resourceType || fallback.resourceType) || "auto",
    originalName: safeStr(doc.originalName || fallback.originalName),
    bytes: Number(doc.bytes || fallback.bytes || 0),
    mimeType: safeStr(doc.mimeType || fallback.mimeType),
    source: safeStr(doc.source || fallback.source),
    sharedAsset: doc.sharedAsset == null ? !!fallback.sharedAsset : !!doc.sharedAsset,
    uploadedAt: doc.uploadedAt || fallback.uploadedAt || new Date(),
  };
}

function buildApplicantSourceDocs(applicant) {
  if (!applicant || typeof applicant !== "object") return [];

  const docs = [];
  const pushDoc = (type, title, doc) => {
    const normalized = normalizeDocShape(doc, {
      source: "applicant_sync",
      sharedAsset: true,
      uploadedAt: applicant.createdAt || new Date(),
    });
    if (!normalized) return;
    docs.push({
      type: normalizeStudentDocType(type, title),
      title: safeStr(title) || titleForStudentDocType(type),
      doc: normalized,
    });
  };

  pushDoc("passport", TITLE_BY_TYPE.passport, applicant.passportPhoto);
  pushDoc("id", TITLE_BY_TYPE.id, applicant.idDocument);
  pushDoc("transcript", TITLE_BY_TYPE.transcript, applicant.transcript);

  const extras = Array.isArray(applicant.otherDocs) ? applicant.otherDocs : [];
  extras.forEach((doc, index) => {
    const title = safeStr(doc?.originalName) || `Other Document ${index + 1}`;
    pushDoc("other", title, doc);
  });

  return docs;
}

async function syncApplicantDocsToStudentDocs({
  StudentDoc,
  applicant,
  studentId,
  uploadedBy = null,
}) {
  if (!StudentDoc || !applicant || !studentId) return { created: 0 };

  const existingRows = await StudentDoc.find({
    student: studentId,
    isDeleted: { $ne: true },
  })
    .select("_id type title doc.publicId")
    .lean();

  const existingRequired = new Set(
    existingRows
      .map((row) => normalizeStudentDocType(row?.type, row?.title))
      .filter((type) => REQUIRED_STUDENT_DOC_TYPES.includes(type))
  );

  const existingPublicIds = new Set(
    existingRows.map((row) => safeStr(row?.doc?.publicId)).filter(Boolean)
  );

  const inserts = [];
  for (const sourceDoc of buildApplicantSourceDocs(applicant)) {
    if (!sourceDoc.doc?.publicId || existingPublicIds.has(sourceDoc.doc.publicId)) continue;
    if (REQUIRED_STUDENT_DOC_TYPES.includes(sourceDoc.type) && existingRequired.has(sourceDoc.type)) continue;

    inserts.push({
      student: studentId,
      type: sourceDoc.type,
      title: sourceDoc.title || titleForStudentDocType(sourceDoc.type),
      doc: {
        ...sourceDoc.doc,
        source: sourceDoc.doc.source || "applicant_sync",
        sharedAsset: true,
      },
      uploadedBy: uploadedBy || null,
      sourceApplicant: applicant._id || null,
    });

    existingPublicIds.add(sourceDoc.doc.publicId);
    if (REQUIRED_STUDENT_DOC_TYPES.includes(sourceDoc.type)) {
      existingRequired.add(sourceDoc.type);
    }
  }

  if (!inserts.length) return { created: 0 };
  await StudentDoc.insertMany(inserts, { ordered: false });
  return { created: inserts.length };
}

async function ensureStudentDocsFromApplicants({
  StudentDoc,
  Applicant,
  studentIds,
  uploadedBy = null,
}) {
  if (!StudentDoc || !Applicant || !Array.isArray(studentIds) || !studentIds.length) {
    return { created: 0 };
  }

  const ids = Array.from(
    new Set(studentIds.map((id) => safeStr(id)).filter(Boolean))
  );
  if (!ids.length) return { created: 0 };

  const applicants = await Applicant.find({
    isDeleted: { $ne: true },
    $or: [
      { linkedStudent: { $in: ids } },
      { convertedStudentId: { $in: ids } },
    ],
  })
    .select("linkedStudent convertedStudentId passportPhoto idDocument transcript otherDocs createdAt")
    .lean();

  let created = 0;
  for (const applicant of applicants) {
    const studentId = safeStr(applicant?.linkedStudent || applicant?.convertedStudentId);
    if (!studentId) continue;
    const result = await syncApplicantDocsToStudentDocs({
      StudentDoc,
      applicant,
      studentId,
      uploadedBy,
    });
    created += Number(result.created || 0);
  }

  return { created };
}

function buildStudentDocSummaries(students, docs) {
  const docsByStudent = new Map();

  (docs || []).forEach((row) => {
    const studentId = safeStr(row?.student || row?.studentId);
    if (!studentId) return;
    if (!docsByStudent.has(studentId)) docsByStudent.set(studentId, []);

    const type = normalizeStudentDocType(row?.type, row?.title);
    docsByStudent.get(studentId).push({
      id: safeStr(row?._id || row?.id),
      studentId,
      type,
      title: safeStr(row?.title) || titleForStudentDocType(type),
      url: safeStr(row?.doc?.url || row?.url),
      originalName: safeStr(row?.doc?.originalName || row?.originalName),
      bytes: Number(row?.doc?.bytes || row?.bytes || 0),
      mimeType: safeStr(row?.doc?.mimeType || row?.mimeType),
      uploadedAt: row?.doc?.uploadedAt || row?.uploadedAt || row?.createdAt || row?.updatedAt || null,
      source: safeStr(row?.doc?.source || row?.source),
      sharedAsset: !!(row?.doc?.sharedAsset ?? row?.sharedAsset),
    });
  });

  return (students || []).map((student) => {
    const studentId = safeStr(student?._id || student?.id);
    const rowDocs = (docsByStudent.get(studentId) || []).sort((a, b) => {
      const aTime = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
      const bTime = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
      return bTime - aTime;
    });

    const presentTypes = new Set(rowDocs.map((doc) => doc.type));
    const present = REQUIRED_STUDENT_DOC_TYPES.filter((type) => presentTypes.has(type));
    const missing = REQUIRED_STUDENT_DOC_TYPES.filter((type) => !presentTypes.has(type));

    const firstDoc = (type) => rowDocs.find((doc) => doc.type === type) || null;
    const extras = rowDocs.filter((doc) => !REQUIRED_STUDENT_DOC_TYPES.includes(doc.type));
    const label = `${student?.regNo ? `${student.regNo} - ` : ""}${student?.fullName || student?.email || "Student"}`;

    return {
      id: studentId,
      label,
      regNo: safeStr(student?.regNo),
      fullName: safeStr(student?.fullName),
      email: safeStr(student?.email),
      present,
      missing,
      docs: rowDocs,
      uploadedCount: rowDocs.length,
      requiredUploadedCount: present.length,
      requiredCount: REQUIRED_STUDENT_DOC_TYPES.length,
      missingCount: missing.length,
      complete: missing.length === 0,
      docState: {
        passportPhoto: firstDoc("passport"),
        idDocument: firstDoc("id"),
        transcript: firstDoc("transcript"),
        otherDocs: extras,
      },
    };
  });
}

module.exports = {
  REQUIRED_STUDENT_DOC_TYPES,
  normalizeStudentDocType,
  titleForStudentDocType,
  syncApplicantDocsToStudentDocs,
  ensureStudentDocsFromApplicants,
  buildStudentDocSummaries,
};
