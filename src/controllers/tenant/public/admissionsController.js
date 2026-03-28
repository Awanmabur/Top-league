const { makeApplicationId } = require("../../../utils/id");
const { uploadBuffer, safeDestroy } = require("../../../utils/cloudinaryUpload");

/**
 * SAFE FILE HELPERS (no optional chaining)
 */
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

function norm(v) {
  return String(v || "").trim();
}

function normLower(v) {
  return norm(v).toLowerCase();
}

function normUpper(v) {
  return norm(v).toUpperCase();
}

function cleanEmail(v) {
  return norm(v).toLowerCase();
}

function getDefaultAcademicYears() {
  const y = new Date().getFullYear();
  return [`${y}/${y + 1}`, `${y + 1}/${y + 2}`];
}

function getSchoolLevels() {
  return [
    { value: "nursery", label: "Nursery" },
    { value: "primary", label: "Primary" },
    { value: "secondary", label: "Secondary" },
  ];
}

function getClassLevels() {
  return [
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
    "S1",
    "S2",
    "S3",
    "S4",
    "S5",
    "S6",
  ];
}

function getTerms() {
  return [
    { value: 1, label: "Term 1" },
    { value: 2, label: "Term 2" },
    { value: 3, label: "Term 3" },
  ];
}

function schoolLevelLabel(v) {
  const map = {
    nursery: "Nursery",
    primary: "Primary",
    secondary: "Secondary",
  };
  return map[normLower(v)] || "—";
}

function isValidSchoolLevel(v) {
  return ["nursery", "primary", "secondary"].includes(normLower(v));
}

function isValidClassLevel(v) {
  return getClassLevels().includes(normUpper(v));
}

function normalizeSubjectChoices(body) {
  const raw = body && body.subjects !== undefined ? body.subjects : [];
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const seen = {};
  const out = [];

  for (let i = 0; i < arr.length; i++) {
    const id = norm(arr[i]);
    if (!id) continue;
    if (seen[id]) continue;
    seen[id] = true;
    out.push({
      subject: id,
      order: i + 1,
    });
  }

  return out;
}

function buildErrors(body, files) {
  const e = {};
  const req = function (k, msg) {
    if (!body || !body[k] || !String(body[k]).trim()) e[k] = msg;
  };

  req("firstName", "First name is required");
  req("lastName", "Last name is required");
  req("gender", "Gender is required");
  req("dob", "Date of birth is required");
  req("nationality", "Nationality is required");
  req("address", "Address is required");
  req("phone", "Phone is required");
  req("email", "Email is required");

  req("academicYear", "Academic year is required");
  req("schoolLevel", "School level is required");
  req("classLevel", "Class level is required");
  req("term", "Term is required");

  req("guardianName", "Guardian name is required");
  req("guardianPhone", "Guardian phone is required");

  if (!body || !body.agree) e.agree = "You must agree before submitting";

  const dob = asDate(body ? body.dob : null);
  if (!dob) e.dob = "Provide a valid date of birth";

  if (!isValidSchoolLevel(body ? body.schoolLevel : "")) {
    e.schoolLevel = "Select a valid school level";
  }

  if (!isValidClassLevel(body ? body.classLevel : "")) {
    e.classLevel = "Select a valid class level";
  }

  const termRaw = norm(body ? body.term : "");
  const term = Number(termRaw);
  if (!termRaw) e.term = "Term is required";
  else if (Number.isNaN(term) || term < 1 || term > 3) e.term = "Term must be 1–3";

  const ycRaw = norm(body ? body.yearCompleted : "");
  const yc = Number(ycRaw);
  const nowY = new Date().getFullYear();
  if (!ycRaw) e.yearCompleted = "Year completed is required";
  else if (Number.isNaN(yc) || yc < 1900 || yc > nowY + 1) e.yearCompleted = "Year completed is invalid";

  const subjectChoices = normalizeSubjectChoices(body);
  if (!subjectChoices.length) e.subjects = "Select at least one subject";

  if (!pickFirst(files, "passportPhoto")) e.passportPhoto = "Passport photo is required";
  if (!pickFirst(files, "idDocument")) e.idDocument = "ID document is required";
  if (!pickFirst(files, "transcript")) e.transcript = "Transcript/Results slip is required";

  return e;
}

function buildViewData(req, subjects, formData, errors, applicationId) {
  const csrfToken = typeof req.csrfToken === "function" ? req.csrfToken() : null;

  return {
    tenant: req.tenant,
    subjects: Array.isArray(subjects) ? subjects : [],
    academicYears: getDefaultAcademicYears(),
    schoolLevels: getSchoolLevels(),
    classLevels: getClassLevels(),
    terms: getTerms(),
    csrfToken: csrfToken,
    formData: formData || null,
    errors: errors || null,
    applicationId: applicationId || null,
  };
}

module.exports = {
  /**
   * APPLY PAGE
   * GET /admissions/apply
   */
  applyPage: async (req, res) => {
    const Subject = req.models ? req.models.Subject : null;

    try {
      const subjects = Subject
        ? await Subject.find({ status: { $ne: "archived" } })
            .select("_id code title shortTitle schoolLevel classLevels term")
            .sort({ title: 1, code: 1 })
            .lean()
        : [];

      return res.render(
        "tenant/public/admissions/apply",
        buildViewData(req, subjects, null, null, null)
      );
    } catch (err) {
      console.error("Apply page error:", err);
      return res.status(500).send("Failed to load application form");
    }
  },

  /**
   * SUBMIT APPLICATION
   * POST /admissions/apply
   */
  submitApplication: async (req, res) => {
    const Applicant = req.models ? req.models.Applicant : null;
    const Subject = req.models ? req.models.Subject : null;

    const subjects = Subject
      ? await Subject.find({ status: { $ne: "archived" } })
          .select("_id code title shortTitle schoolLevel classLevels term")
          .sort({ title: 1, code: 1 })
          .lean()
      : [];

    const errors = buildErrors(req.body, req.files);

    if (Object.keys(errors).length) {
      return res
        .status(422)
        .render(
          "tenant/public/admissions/apply",
          buildViewData(req, subjects, req.body, errors, null)
        );
    }

    const folderBase = process.env.CLOUDINARY_FOLDER || "classic-academy";
    const tenantCode =
      req.tenant && (req.tenant.code || req.tenant._id)
        ? req.tenant.code || req.tenant._id
        : "tenant";
    const folder = `${folderBase}/${tenantCode}/admissions`;

    const uploaded = [];

    function mkDoc(file, up) {
      return {
        url: up.secure_url,
        publicId: up.public_id,
        resourceType: up.resource_type || "auto",
        originalName: file.originalname,
        bytes: file.size || up.bytes || 0,
        mimeType: file.mimetype,
      };
    }

    try {
      const passportFile = pickFirst(req.files, "passportPhoto");
      const idFile = pickFirst(req.files, "idDocument");
      const transcriptFile = pickFirst(req.files, "transcript");
      const otherFiles = pickMany(req.files, "otherDocs");

      const upPassport = await uploadBuffer(passportFile, folder, { resource_type: "image" });
      uploaded.push({ publicId: upPassport.public_id, resourceType: upPassport.resource_type });

      const upId = await uploadBuffer(idFile, folder, { resource_type: "auto" });
      uploaded.push({ publicId: upId.public_id, resourceType: upId.resource_type });

      const upTranscript = await uploadBuffer(transcriptFile, folder, { resource_type: "auto" });
      uploaded.push({ publicId: upTranscript.public_id, resourceType: upTranscript.resource_type });

      const otherDocs = [];
      for (let i = 0; i < otherFiles.length; i++) {
        const f = otherFiles[i];
        const up = await uploadBuffer(f, folder, { resource_type: "auto" });
        uploaded.push({ publicId: up.public_id, resourceType: up.resource_type });
        otherDocs.push(mkDoc(f, up));
      }

      let applicationId = makeApplicationId();
      for (let i = 0; i < 5; i++) {
        const exists = await Applicant.findOne({
          applicationId: applicationId,
          isDeleted: { $ne: true },
        }).lean();
        if (!exists) break;
        applicationId = makeApplicationId();
      }

      const subjectChoices = normalizeSubjectChoices(req.body);

      const doc = await Applicant.create({
        applicationId: applicationId,

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

        academicYear: norm(req.body.academicYear),
        schoolLevel: normLower(req.body.schoolLevel),
        classLevel: normUpper(req.body.classLevel),
        term: Number(req.body.term || 1),
        intake: norm(req.body.intake),

        subjectChoices: subjectChoices,

        qualification: norm(req.body.qualification),
        school: norm(req.body.school),
        yearCompleted: Number(req.body.yearCompleted),
        grades: norm(req.body.grades),
        notes: norm(req.body.notes),

        passportPhoto: mkDoc(passportFile, upPassport),
        idDocument: mkDoc(idFile, upId),
        transcript: mkDoc(transcriptFile, upTranscript),
        otherDocs: otherDocs,
      });

      return res.render(
        "tenant/public/admissions/apply",
        buildViewData(req, subjects, null, null, doc.applicationId)
      );
    } catch (err) {
      for (let i = 0; i < uploaded.length; i++) {
        const u = uploaded[i];
        await safeDestroy(u.publicId, u.resourceType || "auto");
      }

      console.error("Application submit error:", err);

      return res
        .status(500)
        .render(
          "tenant/public/admissions/apply",
          buildViewData(req, subjects, req.body, { general: err.message || "Failed to submit application" }, null)
        );
    }
  },

  /**
   * STATUS PAGE
   * GET /admissions/status
   */
  statusPage: async (req, res) => {
    const csrfToken = typeof req.csrfToken === "function" ? req.csrfToken() : null;

    return res.render("tenant/public/admissions/status", {
      tenant: req.tenant,
      csrfToken: csrfToken,
      query: "",
      result: null,
      error: null,
      documents: [],
      paymentHistory: [],
      auditTrail: [],
    });
  },

  /**
   * CHECK STATUS
   * POST /admissions/status
   */
  checkStatus: async (req, res) => {
    const Applicant = req.models ? req.models.Applicant : null;
    const csrfToken = typeof req.csrfToken === "function" ? req.csrfToken() : null;

    const q = String(req.body && req.body.q ? req.body.q : "").trim();

    if (!q) {
      return res.status(422).render("tenant/public/admissions/status", {
        tenant: req.tenant,
        csrfToken: csrfToken,
        query: q,
        result: null,
        error: "Enter Application ID or Email/Phone",
        documents: [],
        paymentHistory: [],
        auditTrail: [],
      });
    }

    let result = await Applicant.findOne({
      applicationId: q,
      isDeleted: { $ne: true },
    })
      .populate("subjectChoices.subject", "code title shortTitle schoolLevel classLevels term")
      .lean();

    if (!result) {
      result = await Applicant.findOne({
        isDeleted: { $ne: true },
        $or: [{ email: q.toLowerCase() }, { phone: q }],
      })
        .sort({ createdAt: -1 })
        .populate("subjectChoices.subject", "code title shortTitle schoolLevel classLevels term")
        .lean();
    }

    if (!result) {
      return res.status(404).render("tenant/public/admissions/status", {
        tenant: req.tenant,
        csrfToken: csrfToken,
        query: q,
        result: null,
        error: "No application found for that search.",
        documents: [],
        paymentHistory: [],
        auditTrail: [],
      });
    }

    const documents = [];
    if (result.passportPhoto) {
      documents.push({
        key: "passportPhoto",
        label: "Passport Photo",
        originalName: result.passportPhoto.originalName || "Passport Photo",
        url: result.passportPhoto.url || "",
        createdAt: result.createdAt,
        verification: "pending",
      });
    }
    if (result.idDocument) {
      documents.push({
        key: "idDocument",
        label: "National ID / Passport",
        originalName: result.idDocument.originalName || "ID Document",
        url: result.idDocument.url || "",
        createdAt: result.createdAt,
        verification: "pending",
      });
    }
    if (result.transcript) {
      documents.push({
        key: "transcript",
        label: "Transcript / Results Slip",
        originalName: result.transcript.originalName || "Transcript",
        url: result.transcript.url || "",
        createdAt: result.createdAt,
        verification: "pending",
      });
    }
    if (Array.isArray(result.otherDocs)) {
      for (let i = 0; i < result.otherDocs.length; i++) {
        const d = result.otherDocs[i];
        documents.push({
          key: "other",
          label: "Other Document",
          originalName: d.originalName || "Other Document",
          url: d.url || "",
          createdAt: result.createdAt,
          verification: "pending",
        });
      }
    }

    const auditTrail = [
      {
        title: "Application submitted",
        by: "System",
        createdAt: result.createdAt,
      },
    ];

    if (result.status === "under_review") {
      auditTrail.push({
        title: "Application moved to review",
        by: "Admissions",
        createdAt: result.updatedAt || result.createdAt,
      });
    }

    if (result.status === "accepted") {
      auditTrail.push({
        title: "Application accepted",
        by: "Admissions",
        createdAt: result.decidedAt || result.updatedAt || result.createdAt,
      });
    }

    if (result.status === "rejected") {
      auditTrail.push({
        title: "Application rejected",
        by: "Admissions",
        createdAt: result.decidedAt || result.updatedAt || result.createdAt,
      });
    }

    if (result.status === "converted") {
      auditTrail.push({
        title: "Applicant converted to student",
        by: "Admissions",
        createdAt: result.decidedAt || result.updatedAt || result.createdAt,
      });
    }

    return res.render("tenant/public/admissions/status", {
      tenant: req.tenant,
      csrfToken: csrfToken,
      query: q,
      result: result,
      error: null,
      documents: documents,
      paymentHistory: [],
      auditTrail: auditTrail,
      schoolLevelLabel: schoolLevelLabel,
    });
  },
};