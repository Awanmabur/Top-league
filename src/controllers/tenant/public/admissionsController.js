// src/controllers/tenant/public/admissionsController.js
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

/**
 * Default dropdown data (so EJS never crashes even if you forget to pass them)
 */
function getDefaultAcademicYears() {
  const y = new Date().getFullYear();
  return [`${y}/${y + 1}`, `${y + 1}/${y + 2}`];
}
function getDefaultIntakes() {
  return [
    { value: "jan", label: "January" },
    { value: "may", label: "May" },
    { value: "aug", label: "August" },
  ];
}
function getDefaultStudyModes() {
  return ["Full-time", "Part-time", "Evening", "Weekend", "Distance"];
}

function norm(v) {
  return String(v || "").trim();
}
function normLower(v) {
  return norm(v).toLowerCase();
}

function buildErrors(body, files) {
  const e = {};
  const req = (k, msg) => {
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
  req("yearLevel", "Year level is required");
  req("semester", "Semester is required");
  req("intake", "Intake is required");
  req("studyMode", "Study mode is required");
  req("program1", "First choice program is required");

  req("qualification", "Highest qualification is required");
  req("school", "School/Institution is required");
  req("yearCompleted", "Year completed is required");

  req("guardianName", "Guardian name is required");
  req("guardianPhone", "Guardian phone is required");

  if (!body || !body.agree) e.agree = "You must agree before submitting";

  // Validate DOB
  const dob = asDate(body ? body.dob : null);
  if (!dob) e.dob = "Provide a valid date of birth";

  // Semester
  const semRaw = norm(body ? body.semester : "");
  const sem = Number(semRaw);
  if (!semRaw) e.semester = "Semester is required";
  else if (Number.isNaN(sem) || sem < 0 || sem > 6) e.semester = "Semester must be 0–6";

  // Year completed
  const ycRaw = norm(body ? body.yearCompleted : "");
  const yc = Number(ycRaw);
  const nowY = new Date().getFullYear();
  if (!ycRaw) e.yearCompleted = "Year completed is required";
  else if (Number.isNaN(yc) || yc < 1900 || yc > (nowY + 1)) e.yearCompleted = "Year completed is invalid";

  // Files
  if (!pickFirst(files, "passportPhoto")) e.passportPhoto = "Passport photo is required";
  if (!pickFirst(files, "idDocument")) e.idDocument = "ID document is required";
  if (!pickFirst(files, "transcript")) e.transcript = "Transcript/Results slip is required";

  return e;
}

module.exports = {
  /**
   * APPLY PAGE
   * GET /admissions/apply
   */
  applyPage: async (req, res) => {
    const { Program, Class } = req.models;

    try {
      const programs = await Program.find({ isDeleted: { $ne: true } })
        .sort({ name: 1 })
        .lean();

      const classes = await Class.find({ isDeleted: { $ne: true } })
        .sort({ name: 1 })
        .lean();

      const csrfToken = typeof req.csrfToken === "function" ? req.csrfToken() : null;

      return res.render("tenant/public/admissions/apply", {
        tenant: req.tenant,
        programs,
        classes,

        // IMPORTANT: pass these so EJS never hits "is not defined"
        academicYears: getDefaultAcademicYears(),
        intakes: getDefaultIntakes(),
        studyModes: getDefaultStudyModes(),

        csrfToken,
        formData: null,
        errors: null,
        applicationId: null,
      });
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
    const { Applicant, Program, Class } = req.models;

    const programs = await Program.find({ isDeleted: { $ne: true } })
      .sort({ name: 1 })
      .lean();

    const classes = await Class.find({ isDeleted: { $ne: true } })
      .sort({ name: 1 })
      .lean();

    const csrfToken = typeof req.csrfToken === "function" ? req.csrfToken() : null;

    // Always include these for EJS
    const academicYears = getDefaultAcademicYears();
    const intakes = getDefaultIntakes();
    const studyModes = getDefaultStudyModes();

    const errors = buildErrors(req.body, req.files);

    if (Object.keys(errors).length) {
      return res.status(422).render("tenant/public/admissions/apply", {
        tenant: req.tenant,
        programs,
        classes,
        academicYears,
        intakes,
        studyModes,
        csrfToken,
        formData: req.body,
        errors,
        applicationId: null,
      });
    }

    // Cloudinary folder
    const folderBase = process.env.CLOUDINARY_FOLDER || "classic-campus";
    const tenantCode = (req.tenant && (req.tenant.code || req.tenant._id)) ? (req.tenant.code || req.tenant._id) : "tenant";
    const folder = `${folderBase}/${tenantCode}/admissions`;

    const uploaded = []; // cleanup list if DB fails

    const mkDoc = (file, up) => ({
      url: up.secure_url,
      publicId: up.public_id,
      resourceType: up.resource_type || "auto",
      originalName: file.originalname,
      bytes: file.size || up.bytes || 0,
      mimeType: file.mimetype,
    });

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
        // eslint-disable-next-line no-await-in-loop
        const up = await uploadBuffer(f, folder, { resource_type: "auto" });
        uploaded.push({ publicId: up.public_id, resourceType: up.resource_type });
        otherDocs.push(mkDoc(f, up));
      }

      // Unique applicationId
      let applicationId = makeApplicationId();
      for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop
        const exists = await Applicant.findOne({ applicationId, isDeleted: { $ne: true } }).lean();
        if (!exists) break;
        applicationId = makeApplicationId();
      }

      const doc = await Applicant.create({
        applicationId,

        firstName: req.body.firstName,
        middleName: req.body.middleName,
        lastName: req.body.lastName,

        gender: req.body.gender,
        dob: asDate(req.body.dob),
        nationality: req.body.nationality,
        address: req.body.address,

        phone: req.body.phone,
        email: req.body.email,

        guardianName: req.body.guardianName,
        guardianPhone: req.body.guardianPhone,
        guardianEmail: req.body.guardianEmail,

        academicYear: req.body.academicYear,
        semester: Number(req.body.semester || 1),
        yearLevel: req.body.yearLevel,
        intake: req.body.intake,
        studyMode: req.body.studyMode,

        program1: req.body.program1,
        program2: req.body.program2 || null,
        preferredClassGroup: req.body.preferredClassGroup || null,

        qualification: req.body.qualification,
        school: req.body.school,
        yearCompleted: Number(req.body.yearCompleted),
        grades: req.body.grades,

        notes: req.body.notes,

        passportPhoto: mkDoc(passportFile, upPassport),
        idDocument: mkDoc(idFile, upId),
        transcript: mkDoc(transcriptFile, upTranscript),
        otherDocs,
      });

      console.log("BODY:", req.body);
      console.log("FILES:", Object.keys(req.files || {}));

      return res.render("tenant/public/admissions/apply", {
        tenant: req.tenant,
        programs,
        classes,
        academicYears,
        intakes,
        studyModes,
        csrfToken,
        formData: null,
        errors: null,
        applicationId: doc.applicationId,
      });
    } catch (err) {
      // cleanup cloudinary on failure
      for (let i = 0; i < uploaded.length; i++) {
        const u = uploaded[i];
        // eslint-disable-next-line no-await-in-loop
        await safeDestroy(u.publicId, u.resourceType || "auto");
      }

      console.error("Application submit error:", err);

      return res.status(500).render("tenant/public/admissions/apply", {
        tenant: req.tenant,
        programs,
        classes,
        academicYears,
        intakes,
        studyModes,
        csrfToken,
        formData: req.body,
        errors: { general: err.message || "Failed to submit application" },
        applicationId: null,
      });
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
      csrfToken,
      result: null,
      error: null,
    });
  },

  /**
   * CHECK STATUS
   * POST /admissions/status
   */
  checkStatus: async (req, res) => {
    const { Applicant } = req.models;
    const csrfToken = typeof req.csrfToken === "function" ? req.csrfToken() : null;

    const q = String((req.body && req.body.q) || "").trim();

    if (!q) {
      return res.status(422).render("tenant/public/admissions/status", {
        tenant: req.tenant,
        csrfToken,
        result: null,
        error: "Enter Application ID or Email/Phone",
      });
    }

    const result =
      (await Applicant.findOne({ applicationId: q, isDeleted: { $ne: true } })
        .populate("program1", "code name title")
        .lean()) ||
      (await Applicant.findOne({
        isDeleted: { $ne: true },
        $or: [{ email: q.toLowerCase() }, { phone: q }],
      })
        .sort({ createdAt: -1 })
        .populate("program1", "code name title")
        .lean());

    if (!result) {
      return res.status(404).render("tenant/public/admissions/status", {
        tenant: req.tenant,
        csrfToken,
        result: null,
        error: "No application found for that search.",
      });
    }

    return res.render("tenant/public/admissions/status", {
      tenant: req.tenant,
      csrfToken,
      result,
      error: null,
    });
  },
};
