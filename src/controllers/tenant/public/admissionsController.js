const { makeApplicationId } = require("../../../utils/id");
const { uploadBuffer, safeDestroy } = require("../../../utils/cloudinaryUpload");

function pickFirst(files, key) {
  if (!files || !files[key] || !Array.isArray(files[key])) return null;
  return files[key][0] || null;
}
function pickMany(files, key) {
  if (!files || !files[key] || !Array.isArray(files[key])) return [];
  return files[key];
}
function asDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function norm(v) { return String(v || "").trim(); }
function normLower(v) { return norm(v).toLowerCase(); }
function normUpper(v) { return norm(v).toUpperCase(); }
function cleanEmail(v) { return norm(v).toLowerCase(); }
function getSchoolLevels() {
  return [
    { value: "nursery", label: "Nursery" },
    { value: "primary", label: "Primary" },
    { value: "secondary", label: "Secondary" },
  ];
}
function getClassLevels() {
  return ["BABY","MIDDLE","TOP","P1","P2","P3","P4","P5","P6","P7","P8","S1","S2","S3","S4","S5","S6"];
}
function getQualificationOptions(level) {
  const key = normLower(level);
  if (key === "nursery") return ["No previous education"];
  if (key === "primary") return ["Nursery", "No previous education"];
  return ["P7", "P8", "UCE", "UACE", "Certificate", "Diploma"];
}
function isValidSchoolLevel(v) {
  return ["nursery", "primary", "secondary"].includes(normLower(v));
}
function isValidClassLevel(v) {
  return getClassLevels().includes(normUpper(v));
}
function schoolLevelLabel(v) {
  const map = { nursery: "Nursery", primary: "Primary", secondary: "Secondary" };
  return map[normLower(v)] || "—";
}
function selectedQualificationIsNoPrevious(v) {
  return normLower(v) === "no previous education";
}
function buildAcademicYears(terms) {
  const years = new Set();
  (terms || []).forEach((t) => {
    const year = norm(t.year);
    if (year) years.add(year);
  });
  return Array.from(years).sort();
}

function getRequestedSchoolUnitId(req) {
  return norm(req?.body?.schoolUnitId || req?.query?.schoolUnitId || "");
}

function findRequestedSchoolUnit(req, schoolUnitId) {
  const units = req?.tenant?.settings?.academics?.schoolUnits;
  if (!schoolUnitId || !Array.isArray(units)) return null;

  return (
    units.find((unit) => String(unit._id || "") === String(schoolUnitId)) ||
    units.find((unit) => String(unit.id || "") === String(schoolUnitId)) ||
    null
  );
}

function getUploadSession(req) {
  if (!req.session) return null;
  if (!req.session.admissionDraftUploads) req.session.admissionDraftUploads = {};
  return req.session.admissionDraftUploads;
}
function clearUploadSession(req) {
  if (req.session && req.session.admissionDraftUploads) delete req.session.admissionDraftUploads;
}
function normalizeStoredDoc(doc) {
  if (!doc || typeof doc !== "object") return null;
  return {
    url: norm(doc.url),
    publicId: norm(doc.publicId),
    resourceType: norm(doc.resourceType) || "auto",
    originalName: norm(doc.originalName),
    bytes: Number(doc.bytes || 0),
    mimeType: norm(doc.mimeType),
  };
}
function getStoredDocs(req) {
  const bag = getUploadSession(req);
  if (!bag) return { passportPhoto: null, idDocument: null, transcript: null, otherDocs: [] };
  return {
    passportPhoto: normalizeStoredDoc(bag.passportPhoto),
    idDocument: normalizeStoredDoc(bag.idDocument),
    transcript: normalizeStoredDoc(bag.transcript),
    otherDocs: Array.isArray(bag.otherDocs) ? bag.otherDocs.map(normalizeStoredDoc).filter(Boolean) : [],
  };
}
function hasDoc(fileObj, storedObj) {
  return !!fileObj || !!storedObj;
}
async function loadPlacementData(req) {
  const Intake = req.models ? req.models.Intake : null;
  const Stream = req.models ? req.models.Stream : null;
  const Section = req.models ? req.models.Section : null;
  const selectedSchoolUnitId = getRequestedSchoolUnitId(req);
  const selectedSchoolUnit = findRequestedSchoolUnit(req, selectedSchoolUnitId);

  const [terms, streams, sections] = await Promise.all([
    Intake ? Intake.find({ isDeleted: { $ne: true }, status: { $in: ["draft", "open", "closed"] } }).select("_id name year term code status isActive").sort({ isActive: -1, year: -1, name: 1 }).lean() : [],
    Stream ? Stream.find({ status: { $ne: "archived" } }).select("_id name levelType classLevel classId className classStream campusName campusCode schoolUnitId schoolUnitName schoolUnitCode").sort({ levelType: 1, classLevel: 1, name: 1 }).lean() : [],
    Section ? Section.find({ status: { $ne: "archived" } }).select("_id name levelType classLevel classId className classStream campusName campusCode schoolUnitId schoolUnitName schoolUnitCode").sort({ levelType: 1, classLevel: 1, classStream: 1, name: 1 }).lean() : [],
  ]);

  const mappedStreams = streams.map((s) => ({
    _id: String(s._id),
    name: norm(s.name),
    levelType: normLower(s.levelType),
    classLevel: normUpper(s.classLevel),
    classId: s.classId ? String(s.classId) : "",
    className: norm(s.className),
    classStream: normUpper(s.classStream),
    campusName: norm(s.campusName),
    campusCode: norm(s.campusCode),
    schoolUnitId: norm(s.schoolUnitId),
    schoolUnitName: norm(s.schoolUnitName),
    schoolUnitCode: norm(s.schoolUnitCode),
  }));

  const mappedSections = sections.map((s) => ({
    _id: String(s._id),
    name: norm(s.name),
    levelType: normLower(s.levelType),
    classLevel: normUpper(s.classLevel),
    classId: s.classId ? String(s.classId) : "",
    className: norm(s.className),
    classStream: normUpper(s.classStream),
    campusName: norm(s.campusName),
    campusCode: norm(s.campusCode),
    schoolUnitId: norm(s.schoolUnitId),
    schoolUnitName: norm(s.schoolUnitName),
    schoolUnitCode: norm(s.schoolUnitCode),
  }));

  const matchedStreams = selectedSchoolUnitId
    ? mappedStreams.filter((s) => String(s.schoolUnitId || "") === selectedSchoolUnitId)
    : mappedStreams;
  const matchedSections = selectedSchoolUnitId
    ? mappedSections.filter((s) => String(s.schoolUnitId || "") === selectedSchoolUnitId)
    : mappedSections;
  const unitScopedStreams =
    selectedSchoolUnitId && matchedStreams.length ? matchedStreams : mappedStreams;
  const unitScopedSections =
    selectedSchoolUnitId && matchedSections.length ? matchedSections : mappedSections;

  return {
    terms: terms.map((t) => ({
      _id: String(t._id),
      name: norm(t.name),
      year: norm(t.year),
      term: norm(t.term),
      code: norm(t.code),
      status: norm(t.status),
      isActive: !!t.isActive,
    })),
    streams: unitScopedStreams,
    sections: unitScopedSections,
    selectedSchoolUnitId,
    selectedSchoolUnit: selectedSchoolUnit
      ? {
          id: String(selectedSchoolUnit._id || selectedSchoolUnit.id || ""),
          name: norm(selectedSchoolUnit.name),
          code: norm(selectedSchoolUnit.code),
        }
      : null,
  };
}
function buildErrors(body, files, terms, streams, sections, storedDocs = {}) {
  const e = {};
  const reqf = function (k, msg) { if (!body || !body[k] || !String(body[k]).trim()) e[k] = msg; };
  reqf("firstName", "First name is required");
  reqf("lastName", "Last name is required");
  reqf("gender", "Gender is required");
  reqf("dob", "Date of birth is required");
  reqf("nationality", "Nationality is required");
  reqf("address", "Address is required");
  reqf("phone", "Phone is required");
  reqf("email", "Email is required");
  reqf("termId", "Term is required");
  reqf("academicYear", "Academic year is required");
  reqf("schoolLevel", "School level is required");
  reqf("classLevel", "Class level is required");
  reqf("streamId", "Stream is required");
  reqf("section1", "Section is required");
  reqf("guardianName", "Guardian name is required");
  reqf("guardianPhone", "Guardian phone is required");
  if (!body || !body.agree) e.agree = "You must agree before submitting";

  const dob = asDate(body ? body.dob : null);
  if (!dob) e.dob = "Provide a valid date of birth";
  if (!isValidSchoolLevel(body ? body.schoolLevel : "")) e.schoolLevel = "Select a valid school level";
  if (!isValidClassLevel(body ? body.classLevel : "")) e.classLevel = "Select a valid class level";

  const termId = norm(body ? body.termId : "");
  const termDoc = (terms || []).find((t) => String(t._id) === termId);
  if (!termDoc) e.termId = "Select a valid term";
  const selectedAcademicYear = norm(body ? body.academicYear : "");
  const termYear = termDoc ? norm(termDoc.year) : "";
  if (termDoc && selectedAcademicYear && termYear && selectedAcademicYear !== termYear) e.academicYear = "Academic year must match the selected term";

  const streamId = norm(body ? body.streamId : "");
  const streamDoc = (streams || []).find((s) => String(s._id) === streamId);
  if (!streamDoc) e.streamId = "Select a valid stream";

  const secId = norm(body ? body.section1 : "");
  const secDoc = (sections || []).find((s) => String(s._id) === secId);
  if (!secDoc) e.section1 = "Select a valid section";

  if (streamDoc) {
    if (streamDoc.levelType !== normLower(body.schoolLevel)) e.streamId = "Stream does not match school level";
    if (streamDoc.classLevel !== normUpper(body.classLevel)) e.streamId = "Stream does not match class level";
  }
  if (secDoc && streamDoc) {
    if (secDoc.classId !== streamDoc.classId) e.section1 = "Section does not match the selected class";
  }

  const qualification = norm(body ? body.qualification : "");
  const noPrev = selectedQualificationIsNoPrevious(qualification);
  if (!qualification) e.qualification = "Highest qualification is required";
  if (!noPrev) {
    reqf("school", "School/Institution is required");
    reqf("yearCompleted", "Year completed is required");
    const ycRaw = norm(body ? body.yearCompleted : "");
    const yc = Number(ycRaw);
    const nowY = new Date().getFullYear();
    if (ycRaw && (Number.isNaN(yc) || yc < 1900 || yc > nowY + 1)) e.yearCompleted = "Year completed is invalid";
  }

  if (!hasDoc(pickFirst(files, "passportPhoto"), storedDocs.passportPhoto)) e.passportPhoto = "Passport photo is required";
  if (!hasDoc(pickFirst(files, "idDocument"), storedDocs.idDocument)) e.idDocument = "ID document is required";
  if (!noPrev && !hasDoc(pickFirst(files, "transcript"), storedDocs.transcript)) e.transcript = "Transcript/Results slip is required";
  return e;
}
function buildViewData(req, placement, formData, errors, applicationId) {
  const csrfToken = typeof req.csrfToken === "function" ? req.csrfToken() : null;
  const terms = placement && Array.isArray(placement.terms) ? placement.terms : [];
  const streams = placement && Array.isArray(placement.streams) ? placement.streams : [];
  const sections = placement && Array.isArray(placement.sections) ? placement.sections : [];
  const selectedSchoolUnitId = norm(placement?.selectedSchoolUnitId);
  const schoolUnitQuery = selectedSchoolUnitId
    ? `?schoolUnitId=${encodeURIComponent(selectedSchoolUnitId)}`
    : "";
  return {
    tenant: req.tenant,
    terms,
    streams,
    sections,
    selectedSchoolUnitId,
    selectedSchoolUnit: placement?.selectedSchoolUnit || null,
    applyAction: `/admissions/apply${schoolUnitQuery}`,
    academicYears: buildAcademicYears(terms),
    schoolLevels: getSchoolLevels(),
    classLevels: getClassLevels(),
    qualificationMap: {
      nursery: getQualificationOptions("nursery"),
      primary: getQualificationOptions("primary"),
      secondary: getQualificationOptions("secondary"),
    },
    csrfToken,
    formData: formData || null,
    errors: errors || null,
    applicationId: applicationId || null,
    storedUploads: getStoredDocs(req),
  };
}
module.exports = {
  applyPage: async (req, res) => {
    try {
      const placement = await loadPlacementData(req);
      return res.render("tenant/public/admissions/apply", buildViewData(req, placement, null, null, null));
    } catch (err) {
      console.error("Apply page error:", err);
      return res.status(500).send("Failed to load application form");
    }
  },
  submitApplication: async (req, res) => {
    const Applicant = req.models ? req.models.Applicant : null;
    try {
      const placement = await loadPlacementData(req);
      const storedDocs = getStoredDocs(req);
      const errors = buildErrors(req.body, req.files, placement.terms, placement.streams, placement.sections, storedDocs);
      if (Object.keys(errors).length) {
        return res.status(422).render("tenant/public/admissions/apply", buildViewData(req, placement, req.body, errors, null));
      }
      const folderBase = process.env.CLOUDINARY_FOLDER || "classic-academy";
      const tenantCode = req.tenant && (req.tenant.code || req.tenant._id) ? req.tenant.code || req.tenant._id : "tenant";
      const folder = `${folderBase}/${tenantCode}/admissions`;
      const uploaded = [];
      function mkDoc(file, up) {
        if (!file && up && up.url) return normalizeStoredDoc(up);
        return {
          url: up.secure_url,
          publicId: up.public_id,
          resourceType: up.resource_type || "auto",
          originalName: file.originalname,
          bytes: file.size || up.bytes || 0,
          mimeType: file.mimetype,
        };
      }
      const passportFile = pickFirst(req.files, "passportPhoto");
      const idFile = pickFirst(req.files, "idDocument");
      const transcriptFile = pickFirst(req.files, "transcript");
      const otherFiles = pickMany(req.files, "otherDocs");
      const qualification = norm(req.body.qualification);
      const noPrev = selectedQualificationIsNoPrevious(qualification);
      try {
        const upPassport = passportFile ? await uploadBuffer(passportFile, folder, { resource_type: "image" }) : null;
        if (upPassport) uploaded.push({ publicId: upPassport.public_id, resourceType: upPassport.resource_type });
        const upId = idFile ? await uploadBuffer(idFile, folder, { resource_type: "auto" }) : null;
        if (upId) uploaded.push({ publicId: upId.public_id, resourceType: upId.resource_type });
        let upTranscript = null;
        if (!noPrev && transcriptFile) {
          upTranscript = await uploadBuffer(transcriptFile, folder, { resource_type: "auto" });
          uploaded.push({ publicId: upTranscript.public_id, resourceType: upTranscript.resource_type });
        }
        const freshOtherDocs = [];
        for (const f of otherFiles) {
          const up = await uploadBuffer(f, folder, { resource_type: "auto" });
          uploaded.push({ publicId: up.public_id, resourceType: up.resource_type });
          freshOtherDocs.push(mkDoc(f, up));
        }
        const otherDocs = [...(storedDocs.otherDocs || []), ...freshOtherDocs];
        let applicationId = makeApplicationId();
        for (let i = 0; i < 5; i++) {
          const exists = await Applicant.findOne({ applicationId, isDeleted: { $ne: true } }).lean();
          if (!exists) break;
          applicationId = makeApplicationId();
        }
        const termId = norm(req.body.termId);
        const termDoc = placement.terms.find((t) => String(t._id) === termId) || null;
        const streamId = norm(req.body.streamId);
        const streamDoc = placement.streams.find((s) => String(s._id) === streamId) || null;
        const section1 = norm(req.body.section1);
        const section2 = norm(req.body.section2);
        const selectedSchoolUnit = placement.selectedSchoolUnit || null;
        const doc = await Applicant.create({
          applicationId,
          firstName: norm(req.body.firstName),
          middleName: norm(req.body.middleName),
          lastName: norm(req.body.lastName),
          gender: norm(req.body.gender),
          dob: asDate(req.body.dob),
          nationality: norm(req.body.nationality),
          address: norm(req.body.address),
          phone: norm(req.body.phone),
          email: cleanEmail(req.body.email),
          guardianName: norm(req.body.guardianName),
          guardianPhone: norm(req.body.guardianPhone),
          guardianEmail: cleanEmail(req.body.guardianEmail),
          academicYear: norm(termDoc ? termDoc.year : req.body.academicYear),
          schoolLevel: normLower(req.body.schoolLevel),
          classLevel: normUpper(req.body.classLevel),
          schoolUnitId:
            placement.selectedSchoolUnitId ||
            streamDoc?.schoolUnitId ||
            "",
          schoolUnitName:
            selectedSchoolUnit?.name ||
            streamDoc?.schoolUnitName ||
            "",
          schoolUnitCode:
            selectedSchoolUnit?.code ||
            streamDoc?.schoolUnitCode ||
            "",
          term: termDoc && /^\d+$/.test(norm(termDoc.term)) ? Number(termDoc.term) : Number(req.body.term || 1),
          intakeId: termDoc ? termDoc._id : null,
          intake: termDoc ? termDoc.name : "",
          streamId: streamDoc ? streamDoc._id : null,
          streamName: streamDoc ? streamDoc.name : "",
          section1: section1 || null,
          section2: section2 || null,
          program1: section1 || null,
          program2: section2 || null,
          qualification,
          school: noPrev ? "" : norm(req.body.school),
          yearCompleted: noPrev ? null : Number(req.body.yearCompleted || 0),
          grades: norm(req.body.grades),
          notes: norm(req.body.notes),
          passportPhoto: upPassport ? mkDoc(passportFile, upPassport) : storedDocs.passportPhoto,
          idDocument: upId ? mkDoc(idFile, upId) : storedDocs.idDocument,
          transcript: noPrev ? null : (upTranscript ? mkDoc(transcriptFile, upTranscript) : storedDocs.transcript),
          otherDocs,
        });
        clearUploadSession(req);
        return res.render("tenant/public/admissions/apply", buildViewData(req, placement, null, null, doc.applicationId));
      } catch (err) {
        for (const u of uploaded) await safeDestroy(u.publicId, u.resourceType || "auto");
        console.error("Application submit error:", err);
        return res.status(500).render("tenant/public/admissions/apply", buildViewData(req, placement, req.body, { general: err.message || "Failed to submit application" }, null));
      }
    } catch (err) {
      console.error("Application submit bootstrap error:", err);
      return res.status(500).send("Failed to submit application");
    }
  },
  uploadDraftFiles: async (req, res) => {
    try {
      const folderBase = process.env.CLOUDINARY_FOLDER || "classic-academy";
      const tenantCode = req.tenant && (req.tenant.code || req.tenant._id) ? req.tenant.code || req.tenant._id : "tenant";
      const folder = `${folderBase}/${tenantCode}/admissions`;
      const bag = getUploadSession(req);
      if (!bag) return res.status(500).json({ ok: false, message: "Upload session unavailable" });
      function fromUpload(file, up) {
        return {
          url: up.secure_url,
          publicId: up.public_id,
          resourceType: up.resource_type || "auto",
          originalName: file.originalname,
          bytes: file.size || up.bytes || 0,
          mimeType: file.mimetype,
        };
      }
      async function replaceOne(key, file, opts = { resource_type: "auto" }) {
        if (!file) return null;
        const oldDoc = normalizeStoredDoc(bag[key]);
        if (oldDoc && oldDoc.publicId) await safeDestroy(oldDoc.publicId, oldDoc.resourceType || "auto");
        const up = await uploadBuffer(file, folder, opts);
        bag[key] = fromUpload(file, up);
        return bag[key];
      }
      const passportFile = pickFirst(req.files, "passportPhoto");
      const idFile = pickFirst(req.files, "idDocument");
      const transcriptFile = pickFirst(req.files, "transcript");
      const otherFiles = pickMany(req.files, "otherDocs");
      if (!passportFile && !idFile && !transcriptFile && !otherFiles.length) {
        return res.status(400).json({ ok: false, message: "No files received" });
      }
      const saved = {};
      if (passportFile) saved.passportPhoto = await replaceOne("passportPhoto", passportFile, { resource_type: "image" });
      if (idFile) saved.idDocument = await replaceOne("idDocument", idFile, { resource_type: "auto" });
      if (transcriptFile) saved.transcript = await replaceOne("transcript", transcriptFile, { resource_type: "auto" });
      if (otherFiles.length) {
        if (!Array.isArray(bag.otherDocs)) bag.otherDocs = [];
        for (const f of otherFiles) {
          const up = await uploadBuffer(f, folder, { resource_type: "auto" });
          bag.otherDocs.push(fromUpload(f, up));
        }
        saved.otherDocs = bag.otherDocs;
      }
      req.session.save(() => res.json({ ok: true, saved, uploads: getStoredDocs(req) }));
    } catch (err) {
      console.error("Draft upload error:", err);
      return res.status(500).json({ ok: false, message: err.message || "Upload failed" });
    }
  },
  statusPage: async (req, res) => {
    const csrfToken = typeof req.csrfToken === "function" ? req.csrfToken() : null;
    return res.render("tenant/public/admissions/status", { tenant: req.tenant, csrfToken, query: "", result: null, error: null, documents: [], paymentHistory: [], auditTrail: [] });
  },
  checkStatus: async (req, res) => {
    const Applicant = req.models ? req.models.Applicant : null;
    const csrfToken = typeof req.csrfToken === "function" ? req.csrfToken() : null;
    const q = String(req.body && req.body.q ? req.body.q : "").trim();
    if (!q) {
      return res.status(422).render("tenant/public/admissions/status", { tenant: req.tenant, csrfToken, query: q, result: null, error: "Enter Application ID or Email/Phone", documents: [], paymentHistory: [], auditTrail: [] });
    }
    let result = await Applicant.findOne({ applicationId: q, isDeleted: { $ne: true } }).populate("section1", "name levelType classLevel classStream className").populate("section2", "name levelType classLevel classStream className").populate("streamId", "name").populate("intakeId", "name year").lean();
    if (!result) {
      result = await Applicant.findOne({ isDeleted: { $ne: true }, $or: [{ email: q.toLowerCase() }, { phone: q }] }).sort({ createdAt: -1 }).populate("section1", "name levelType classLevel classStream className").populate("section2", "name levelType classLevel classStream className").populate("streamId", "name").populate("intakeId", "name year").lean();
    }
    if (!result) {
      return res.status(404).render("tenant/public/admissions/status", { tenant: req.tenant, csrfToken, query: q, result: null, error: "No application found for that search.", documents: [], paymentHistory: [], auditTrail: [] });
    }
    const documents = [];
    if (result.passportPhoto) documents.push({ key: "passportPhoto", label: "Passport Photo", originalName: result.passportPhoto.originalName || "Passport Photo", url: result.passportPhoto.url || "", createdAt: result.createdAt, verification: "pending" });
    if (result.idDocument) documents.push({ key: "idDocument", label: "ID Document", originalName: result.idDocument.originalName || "ID Document", url: result.idDocument.url || "", createdAt: result.createdAt, verification: "pending" });
    if (result.transcript) documents.push({ key: "transcript", label: "Transcript / Results Slip", originalName: result.transcript.originalName || "Transcript", url: result.transcript.url || "", createdAt: result.createdAt, verification: "pending" });
    return res.render("tenant/public/admissions/status", { tenant: req.tenant, csrfToken, query: q, result, error: null, documents, paymentHistory: [], auditTrail: [] });
  },
};
