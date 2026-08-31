const { uploadBuffer, safeDestroy } = require("../../../utils/cloudinaryUpload");
const svc = require("../../../services/tenant/scholarshipService");
const { assertActiveProgram } = require("../../../services/tenant/organizationCatalogService");

function pickFirst(files, key) { return files?.[key]?.[0] || null; }
function pickMany(files, key) { return Array.isArray(files?.[key]) ? files[key] : []; }

function buildErrors(body, files, scholarship) {
  const e = {};
  const req = (k, msg) => { if (!body?.[k] || !String(body[k]).trim()) e[k] = msg; };
  req("fullName", "Full name is required");
  req("phone", "Phone is required");
  req("email", "Email is required");
  req("academicYear", "Academic year is required");
  req("yearLevel", "Year level is required");
  if (body?.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email).trim())) e.email = "Enter a valid email address";
  if (!pickFirst(files, "transcript")) e.transcript = "Transcript is required";
  if (scholarship?.programId && String(body?.program || "") !== String(scholarship.programId?._id || scholarship.programId)) {
    e.program = "Select the program targeted by this scholarship.";
  }
  return e;
}

async function getPrograms(models, scholarship) {
  const Subject = models.Program || models.Subject;
  if (!Subject) return [];
  if (scholarship?.programId) {
    const id = scholarship.programId?._id || scholarship.programId;
    const one = await Subject.findOne({ _id: id }).select("code name title shortTitle").lean();
    return one ? [one] : [];
  }
  return Subject.find({ isDeleted: { $ne: true }, status: "active" }).select("code name title shortTitle").sort({ title: 1, code: 1 }).limit(1000).lean();
}

async function getPublicScholarship(models, id) {
  if (!svc.isValidId(id)) return null;
  const doc = await models.Scholarship.findOne({ _id: id, ...svc.publicScholarshipFilter(new Date()) })
    .populate("programId", "code name title shortTitle")
    .lean();
  return doc && svc.isPublicScholarship(doc) ? doc : null;
}

async function resolveStudent(models, body) {
  const Student = models.Student;
  if (!Student) return null;
  const reg = svc.normalizeRegNo(body.regNo);
  if (!reg) return null;
  return Student.findOne({
    $or: [
      { admissionNumber: new RegExp(`^${svc.escapeRegex(reg)}$`, "i") },
      { regNo: new RegExp(`^${svc.escapeRegex(reg)}$`, "i") },
    ],
  }).select("_id").lean();
}

module.exports = {
  async listPublic(req, res) {
    const { Scholarship } = req.models;
    const docs = await Scholarship.find(svc.publicScholarshipFilter(new Date()))
      .populate("programId", "code name title shortTitle")
      .sort({ endDate: 1, createdAt: -1 })
      .lean();
    const scholarships = docs.filter((x) => svc.isPublicScholarship(x)).map(svc.toPublicScholarship);
    return res.render("tenant/public/scholarships/index", { tenant: req.tenant, csrfToken: req.csrfToken?.(), scholarships });
  },

  async viewPublic(req, res) {
    const doc = await getPublicScholarship(req.models, req.params.id);
    if (!doc) return res.status(404).send("Scholarship not found or applications are closed");
    return res.render("tenant/public/scholarships/view", {
      tenant: req.tenant, csrfToken: req.csrfToken?.(), scholarship: svc.toPublicScholarship(doc),
    });
  },

  async applyPage(req, res) {
    const doc = await getPublicScholarship(req.models, req.params.id);
    if (!doc) return res.status(404).send("Scholarship not found or applications are closed");
    const programs = await getPrograms(req.models, doc);
    return res.render("tenant/public/scholarships/apply", {
      tenant: req.tenant, csrfToken: req.csrfToken?.(), scholarship: svc.toPublicScholarship(doc), programs,
      errors: null, formData: null, applicationId: null,
    });
  },

  async submitApplication(req, res) {
    const { ScholarshipApplication } = req.models;
    const doc = await getPublicScholarship(req.models, req.params.id);
    if (!doc) return res.status(404).send("Scholarship not found or applications are closed");
    const programs = await getPrograms(req.models, doc);
    const errors = buildErrors(req.body, req.files, doc);
    const allFiles = [pickFirst(req.files, "transcript"), pickFirst(req.files, "idDocument"), pickFirst(req.files, "recommendationLetter"), ...pickMany(req.files, "otherDocs")].filter(Boolean);
    try { allFiles.forEach(svc.assertFileSignature); } catch (err) { errors.general = err.message; }
    if (Object.keys(errors).length) {
      return res.status(422).render("tenant/public/scholarships/apply", {
        tenant: req.tenant, csrfToken: req.csrfToken?.(), scholarship: svc.toPublicScholarship(doc), programs,
        errors, formData: req.body, applicationId: null,
      });
    }

    let activeProgramId = null;
    try {
      activeProgramId = svc.isValidId(req.body.program) ? await assertActiveProgram(req.models.Program, req.body.program) : null;
      if (doc.programId && String(activeProgramId || "") !== String(doc.programId?._id || doc.programId)) {
        throw new Error("Select the program targeted by this scholarship.");
      }
    } catch (err) {
      return res.status(422).render("tenant/public/scholarships/apply", {
        tenant: req.tenant, csrfToken: req.csrfToken?.(), scholarship: svc.toPublicScholarship(doc), programs,
        errors: { program: err.message || "Select a valid academic program." }, formData: req.body, applicationId: null,
      });
    }

    const student = await resolveStudent(req.models, req.body);
    const key = svc.applicantKey({ student: student?._id, regNo: req.body.regNo, email: req.body.email, phone: req.body.phone });
    if (!key) {
      return res.status(422).render("tenant/public/scholarships/apply", {
        tenant: req.tenant, csrfToken: req.csrfToken?.(), scholarship: svc.toPublicScholarship(doc), programs,
        errors: { general: "Applicant identity could not be verified." }, formData: req.body, applicationId: null,
      });
    }
    const duplicate = await ScholarshipApplication.exists({ scholarship: doc._id, applicantKey: key, isDeleted: { $ne: true } });
    if (duplicate) {
      return res.status(409).render("tenant/public/scholarships/apply", {
        tenant: req.tenant, csrfToken: req.csrfToken?.(), scholarship: svc.toPublicScholarship(doc), programs,
        errors: { general: "An application for this applicant already exists for this scholarship." }, formData: req.body, applicationId: null,
      });
    }

    const uploaded = [];
    const folderBase = process.env.CLOUDINARY_FOLDER || "classic-academy";
    const folder = `${folderBase}/${req.tenant?.code || req.tenant?._id || "tenant"}/scholarships`;
    const mkDoc = (file, up) => ({ url: up.secure_url, publicId: up.public_id, resourceType: up.resource_type || "auto", originalName: svc.str(file.originalname, 200), bytes: file.size || up.bytes || 0, mimeType: svc.str(file.mimetype, 120) });

    try {
      const transcriptFile = pickFirst(req.files, "transcript");
      const idFile = pickFirst(req.files, "idDocument");
      const recFile = pickFirst(req.files, "recommendationLetter");
      const otherFiles = pickMany(req.files, "otherDocs");
      const uploadOne = async (file) => {
        if (!file) return null;
        const up = await uploadBuffer(file, folder, { resource_type: "auto" });
        uploaded.push({ publicId: up.public_id, resourceType: up.resource_type });
        return mkDoc(file, up);
      };
      const transcript = await uploadOne(transcriptFile);
      const idDocument = await uploadOne(idFile);
      const recommendationLetter = await uploadOne(recFile);
      const otherDocs = [];
      for (const f of otherFiles) otherDocs.push(await uploadOne(f));

      let created = null;
      for (let attempt = 0; attempt < 10 && !created; attempt += 1) {
        const applicationId = await svc.allocateApplicationId(ScholarshipApplication);
        try {
          // eslint-disable-next-line no-await-in-loop
          created = await ScholarshipApplication.create({
            applicationId, applicantKey: key, scholarship: doc._id, student: student?._id || null,
            fullName: svc.str(req.body.fullName, 120), email: svc.normalizeEmail(req.body.email), phone: svc.str(req.body.phone, 40),
            regNo: svc.normalizeRegNo(req.body.regNo), program: activeProgramId,
            yearLevel: svc.str(req.body.yearLevel, 30), academicYear: svc.str(req.body.academicYear, 20),
            gpa: req.body.gpa === "" || req.body.gpa == null ? null : Number(req.body.gpa), motivation: svc.str(req.body.motivation, 4000), financialNeed: svc.str(req.body.financialNeed, 4000),
            transcript, idDocument, recommendationLetter, otherDocs, status: "submitted", createdBy: null, updatedBy: null,
          });
        } catch (err) {
          if (err?.code === 11000 && err?.keyPattern?.applicationId) continue;
          throw err;
        }
      }
      if (!created) throw new Error("Could not allocate a unique application ID.");
      return res.render("tenant/public/scholarships/apply", {
        tenant: req.tenant, csrfToken: req.csrfToken?.(), scholarship: svc.toPublicScholarship(doc), programs,
        errors: null, formData: null, applicationId: created.applicationId,
      });
    } catch (err) {
      for (const u of uploaded) await safeDestroy(u.publicId, u.resourceType || "auto");
      const message = err?.code === 11000 ? "An application for this applicant already exists for this scholarship." : (err?.message || "Failed to submit application");
      return res.status(err?.code === 11000 ? 409 : 500).render("tenant/public/scholarships/apply", {
        tenant: req.tenant, csrfToken: req.csrfToken?.(), scholarship: svc.toPublicScholarship(doc), programs,
        errors: { general: message }, formData: req.body, applicationId: null,
      });
    }
  },

  async statusPage(req, res) {
    return res.render("tenant/public/scholarships/status", { tenant: req.tenant, csrfToken: req.csrfToken?.(), result: null, error: null });
  },

  async checkStatus(req, res) {
    const { ScholarshipApplication } = req.models;
    const applicationId = svc.str(req.body.applicationId, 60).toUpperCase();
    const contact = svc.str(req.body.contact, 160);
    if (!applicationId || !contact) {
      return res.status(422).render("tenant/public/scholarships/status", { tenant: req.tenant, csrfToken: req.csrfToken?.(), result: null, error: "Enter your Application ID and the same email or phone used to apply." });
    }
    const result = await ScholarshipApplication.findOne({
      applicationId, isDeleted: { $ne: true },
      $or: [{ email: svc.normalizeEmail(contact) }, { phone: contact }],
    }).populate("scholarship", "name code status").lean();
    if (!result) {
      return res.status(404).render("tenant/public/scholarships/status", { tenant: req.tenant, csrfToken: req.csrfToken?.(), result: null, error: "No matching application was found." });
    }
    if (result.scholarship) result.scholarship.title = result.scholarship.name;
    return res.render("tenant/public/scholarships/status", { tenant: req.tenant, csrfToken: req.csrfToken?.(), result, error: null });
  },
};
