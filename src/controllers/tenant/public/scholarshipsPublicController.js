const mongoose = require("mongoose");
const { makeApplicationId } = require("../../../utils/id");
const { uploadBuffer, safeDestroy } = require("../../../utils/cloudinaryUpload");

function isObjectId(v) {
  return mongoose.Types.ObjectId.isValid(String(v || ""));
}
function pickFirst(files, key) {
  return files?.[key]?.[0] || null;
}
function pickMany(files, key) {
  return Array.isArray(files?.[key]) ? files[key] : [];
}
function asDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function buildErrors(body, files) {
  const e = {};
  const req = (k, msg) => {
    if (!body?.[k] || !String(body[k]).trim()) e[k] = msg;
  };

  req("fullName", "Full name is required");
  req("phone", "Phone is required");
  req("email", "Email is required");

  req("academicYear", "Academic year is required");
  req("yearLevel", "Year level is required");

  // documents (required transcript)
  if (!pickFirst(files, "transcript")) e.transcript = "Transcript is required";

  return e;
}

module.exports = {
  async listPublic(req, res) {
    const { Scholarship } = req.models;

    const scholarships = await Scholarship.find({
      isDeleted: { $ne: true },
      status: "open",
    })
      .sort({ closeDate: 1, createdAt: -1 })
      .lean();

    return res.render("tenant/public/scholarships/index", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      scholarships,
    });
  },

  async viewPublic(req, res) {
    const { Scholarship } = req.models;

    if (!isObjectId(req.params.id)) return res.status(404).send("Invalid ID");

    const scholarship = await Scholarship.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
      .populate("programs", "code name title")
      .lean();

    if (!scholarship) return res.status(404).send("Scholarship not found");

    return res.render("tenant/public/scholarships/view", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      scholarship,
    });
  },

  async applyPage(req, res) {
    const { Scholarship, Subject } = req.models;

    if (!isObjectId(req.params.id)) return res.status(404).send("Invalid ID");

    const scholarship = await Scholarship.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
      .populate("programs", "code name title")
      .lean();

    if (!scholarship) return res.status(404).send("Scholarship not found");

    const programs = Subject
      ? await Subject.find({ status: { $ne: "archived" } }).sort({ title: 1, code: 1 }).lean()
      : [];

    return res.render("tenant/public/scholarships/apply", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      scholarship,
      programs,
      errors: null,
      formData: null,
      applicationId: null,
    });
  },

  async submitApplication(req, res) {
    const { Scholarship, ScholarshipApplication, Subject } = req.models;

    if (!isObjectId(req.params.id)) return res.status(404).send("Invalid ID");

    const scholarship = await Scholarship.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
    if (!scholarship) return res.status(404).send("Scholarship not found");

    const programs = Subject
      ? await Subject.find({ status: { $ne: "archived" } }).sort({ title: 1, code: 1 }).lean()
      : [];

    const errors = buildErrors(req.body, req.files);
    if (Object.keys(errors).length) {
      return res.status(422).render("tenant/public/scholarships/apply", {
        tenant: req.tenant,
        csrfToken: req.csrfToken?.(),
        scholarship,
        programs,
        errors,
        formData: req.body,
        applicationId: null,
      });
    }

    const uploaded = [];
    const folderBase = process.env.CLOUDINARY_FOLDER || "classic-academy";
    const folder = `${folderBase}/${req.tenant?.code || req.tenant?._id || "tenant"}/scholarships`;

    const mkDoc = (file, up) => ({
      url: up.secure_url,
      publicId: up.public_id,
      resourceType: up.resource_type || "auto",
      originalName: file.originalname,
      bytes: file.size || up.bytes || 0,
      mimeType: file.mimetype,
    });

    try {
      const transcriptFile = pickFirst(req.files, "transcript");
      const idFile = pickFirst(req.files, "idDocument");
      const recFile = pickFirst(req.files, "recommendationLetter");
      const otherFiles = pickMany(req.files, "otherDocs");

      const upTranscript = await uploadBuffer(transcriptFile, folder, { resource_type: "auto" });
      uploaded.push({ publicId: upTranscript.public_id, resourceType: upTranscript.resource_type });

      let upId = null;
      if (idFile) {
        upId = await uploadBuffer(idFile, folder, { resource_type: "auto" });
        uploaded.push({ publicId: upId.public_id, resourceType: upId.resource_type });
      }

      let upRec = null;
      if (recFile) {
        upRec = await uploadBuffer(recFile, folder, { resource_type: "auto" });
        uploaded.push({ publicId: upRec.public_id, resourceType: upRec.resource_type });
      }

      const otherDocs = [];
      for (const f of otherFiles) {
        const up = await uploadBuffer(f, folder, { resource_type: "auto" });
        uploaded.push({ publicId: up.public_id, resourceType: up.resource_type });
        otherDocs.push(mkDoc(f, up));
      }

      // unique applicationId
      let applicationId = makeApplicationId();
      for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop
        const exists = await ScholarshipApplication.findOne({ applicationId, isDeleted: { $ne: true } }).lean();
        if (!exists) break;
        applicationId = makeApplicationId();
      }

      const doc = await ScholarshipApplication.create({
        applicationId,
        scholarship: scholarship._id,

        fullName: req.body.fullName,
        email: req.body.email,
        phone: req.body.phone,

        regNo: req.body.regNo || "",
        program: isObjectId(req.body.program) ? req.body.program : null,
        yearLevel: req.body.yearLevel || "",
        academicYear: req.body.academicYear || "",
        gpa: req.body.gpa ? Number(req.body.gpa) : null,

        motivation: req.body.motivation || "",
        financialNeed: req.body.financialNeed || "",

        transcript: mkDoc(transcriptFile, upTranscript),
        idDocument: upId ? mkDoc(idFile, upId) : null,
        recommendationLetter: upRec ? mkDoc(recFile, upRec) : null,
        otherDocs,
      });

      return res.render("tenant/public/scholarships/apply", {
        tenant: req.tenant,
        csrfToken: req.csrfToken?.(),
        scholarship,
        programs,
        errors: null,
        formData: null,
        applicationId: doc.applicationId,
      });
    } catch (err) {
      for (const u of uploaded) {
        // eslint-disable-next-line no-await-in-loop
        await safeDestroy(u.publicId, u.resourceType || "auto");
      }

      return res.status(500).render("tenant/public/scholarships/apply", {
        tenant: req.tenant,
        csrfToken: req.csrfToken?.(),
        scholarship,
        programs,
        errors: { general: err.message || "Failed to submit application" },
        formData: req.body,
        applicationId: null,
      });
    }
  },

  async statusPage(req, res) {
    return res.render("tenant/public/scholarships/status", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      result: null,
      error: null,
    });
  },

  async checkStatus(req, res) {
    const { ScholarshipApplication } = req.models;
    const q = String(req.body.q || "").trim();
    if (!q) {
      return res.status(422).render("tenant/public/scholarships/status", {
        tenant: req.tenant,
        csrfToken: req.csrfToken?.(),
        result: null,
        error: "Enter Application ID or Email/Phone",
      });
    }

    const result =
      (await ScholarshipApplication.findOne({ applicationId: q.toUpperCase(), isDeleted: { $ne: true } })
        .populate("scholarship", "title code status")
        .lean()) ||
      (await ScholarshipApplication.findOne({
        isDeleted: { $ne: true },
        $or: [{ email: q.toLowerCase() }, { phone: q }],
      })
        .sort({ createdAt: -1 })
        .populate("scholarship", "title code status")
        .lean());

    if (!result) {
      return res.status(404).render("tenant/public/scholarships/status", {
        tenant: req.tenant,
        csrfToken: req.csrfToken?.(),
        result: null,
        error: "No application found for that search.",
      });
    }

    return res.render("tenant/public/scholarships/status", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      result,
      error: null,
    });
  },
};
