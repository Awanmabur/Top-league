const crypto = require("crypto");
const mongoose = require("mongoose");

const {
  platformConnection,
  getTenantConnection,
} = require("../../../config/db");
const Tenant = require("../../../models/platform/Tenant")(platformConnection);
const loadTenantModels = require("../../../models/tenant/loadModels");

const {
  uploadBuffer,
  safeDestroy,
} = require("../../../utils/cloudinaryUpload");

function safeLower(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}
function csvToArray(s) {
  return String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}
function linesToArray(s) {
  return String(s || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}
function ipHash(ip) {
  if (!ip) return "";
  return crypto.createHash("sha256").update(String(ip)).digest("hex");
}

function parseAwards(text) {
  const rows = linesToArray(text);
  return rows
    .map((r) => r.split("|").map((x) => x.trim()))
    .filter((p) => p[0])
    .map((p, idx) => ({
      title: p[0],
      organization: p[1] || "",
      year: p[2] ? Number(p[2]) : undefined,
      description: p[3] || "",
      sort: idx,
    }));
}

function parseNews(text) {
  const rows = linesToArray(text);
  return rows
    .map((r) => r.split("|").map((x) => x.trim()))
    .filter((p) => p[0])
    .map((p, idx) => ({
      title: p[0],
      date: p[1] ? new Date(p[1]) : new Date(),
      body: p[2] || "",
      pinned: false,
      sort: idx,
      isPublished: true, // ✅ so public can show it if you filter later
    }));
}

// ✅ normalize gallery items (prevents old-bug items breaking new uploads)
function normalizeGallery(p) {
  if (!Array.isArray(p.gallery)) p.gallery = [];
  p.gallery = p.gallery
    .map((g) => {
      if (!g || !g.url || !g.publicId) return null;
      return {
        url: String(g.url),
        publicId: String(g.publicId),
        caption: String(g.caption || ""),
        sort: Number.isFinite(Number(g.sort)) ? Number(g.sort) : 0,
        uploadedAt: g.uploadedAt ? new Date(g.uploadedAt) : new Date(),
      };
    })
    .filter(Boolean);
}

function wantsJson(req) {
  return (
    req.xhr ||
    (req.get("accept") || "").includes("application/json") ||
    req.get("x-requested-with") === "XMLHttpRequest"
  );
}

// Identify tenant
async function getTenantFromReq(req) {
  const code =
    req?.tenant?.code ||
    req?.session?.tenantCode ||
    safeLower(req?.headers?.host || "").split(".")[0];

  if (!code) throw new Error("Tenant code missing.");
  const tenant = await Tenant.findOne({
    code: safeLower(code),
    isDeleted: { $ne: true },
  });
  if (!tenant) throw new Error("Tenant not found.");
  return tenant;
}

// Optional stats from tenant DB (non-fatal)
async function getStatsFromTenantDB(tenant) {
  try {
    const conn = await getTenantConnection(tenant.dbName);
    const models = loadTenantModels(conn);

    const [students, subjects, staff] = await Promise.all([
      models.Student
        ? models.Student.countDocuments({ isDeleted: { $ne: true } })
        : 0,
      models.Subject
        ? models.Subject.countDocuments({ status: { $ne: "archived" } })
        : 0,
      models.Staff
        ? models.Staff.countDocuments({ isDeleted: { $ne: true } })
        : 0,
    ]);

    return {
      students,
      subjects,
      staff,
      campuses: tenant?.settings?.profile?.stats?.campuses || 0,
    };
  } catch (_) {
    return { students: 0, subjects: 0, staff: 0, campuses: 0 };
  }
}

module.exports = {
  // ✅ GET /admin/settings
  page: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);

      const stats = await getStatsFromTenantDB(tenantDoc);

      tenantDoc.settings = tenantDoc.settings || {};
      tenantDoc.settings.branding = tenantDoc.settings.branding || {};
      tenantDoc.settings.profile = tenantDoc.settings.profile || {};

      const p = tenantDoc.settings.profile;
      p.stats = { ...p.stats, ...stats };

      // ✅ make sure arrays exist
      if (!Array.isArray(p.faqs)) p.faqs = [];
      if (!Array.isArray(p.reviews)) p.reviews = [];
      if (!Array.isArray(p.announcements)) p.announcements = [];
      if (!Array.isArray(p.awards)) p.awards = [];
      if (!Array.isArray(p.facilities)) p.facilities = [];
      if (!Array.isArray(p.values)) p.values = [];

      normalizeGallery(p);

      await tenantDoc.save();

      const reviews = p.reviews || [];
      const pending = reviews.filter((r) => r.status === "pending");
      const approved = reviews.filter((r) => r.status === "approved");

      return res.render("tenant/settings/school-profile", {
        tenant: tenantDoc.toObject(),
        pending,
        approved,
        faqs: p.faqs,
        success: req.query.success ? "Saved successfully ✅" : null,
        error: null,
      });
    } catch (err) {
      console.error("settings page:", err);
      return res.status(500).send(err.message || "Failed to load settings.");
    }
  },

  // ✅ POST /admin/settings
  update: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);
      const b = req.body || {};

      tenantDoc.settings = tenantDoc.settings || {};
      tenantDoc.settings.branding = tenantDoc.settings.branding || {};
      tenantDoc.settings.profile = tenantDoc.settings.profile || {};

      const p = tenantDoc.settings.profile;
      const br = tenantDoc.settings.branding;

      tenantDoc.name = (b.name || tenantDoc.name || "").trim();

      p.type = (b.type || p.type || "").trim();
      p.tagline = (b.tagline || "").trim();
      p.foundedYear = b.foundedYear ? Number(b.foundedYear) : p.foundedYear;
      p.system = (b.system || "").trim();

      p.about = (b.about || "").trim();
      p.mission = (b.mission || "").trim();
      p.vision = (b.vision || "").trim();
      p.values = csvToArray(b.values);

      // ✅ WHY CHOOSE US: save to BOTH keys (fix public mismatch)
      const why = linesToArray(b.whyChooseUs);
      p.whyChooseUs = why;
      p.highlights = why;

      p.facilities = csvToArray(b.facilities);

      // contacts
      p.contact = p.contact || {};
      p.contact.phone = (b.phone || "").trim();
      p.contact.email = safeLower(b.email || "");
      p.contact.website = (b.website || "").trim();
      p.contact.addressFull = (b.addressFull || "").trim();

      // address used on public
      p.address = (b.addressFull || b.address || p.address || "").trim();

      // socials
      p.socials = p.socials || {};
      p.socials.facebook = (b.facebook || "").trim();
      p.socials.instagram = (b.instagram || "").trim();

      // branding
      br.primaryColor = (b.primaryColor || br.primaryColor || "#0a3d62").trim();
      br.accentColor = (b.accentColor || br.accentColor || "#0a6fbf").trim();

      if (typeof b.awardsText === "string")
        p.awards = parseAwards(b.awardsText);
      if (typeof b.newsText === "string")
        p.announcements = parseNews(b.newsText);

      normalizeGallery(p);

      await tenantDoc.save();
      return res.redirect("/admin/settings?success=1");
    } catch (err) {
      console.error("settings update:", err);
      return res.status(400).send(err.message || "Failed to save.");
    }
  },

  // ✅ uploads
  uploadLogo: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);
      if (!req.file)
        return res.status(400).json({ ok: false, message: "No file." });

      const folder = `classic-academy/${tenantDoc.code}/logo`;
      const result = await uploadBuffer(req.file, folder, {
        resource_type: "image",
      });

      const oldPublicId = tenantDoc.settings?.branding?.logoPublicId;
      if (oldPublicId) await safeDestroy(oldPublicId, "image");

      tenantDoc.settings = tenantDoc.settings || {};
      tenantDoc.settings.branding = tenantDoc.settings.branding || {};
      tenantDoc.settings.branding.logoUrl = result.secure_url || result.url;
      tenantDoc.settings.branding.logoPublicId = result.public_id;

      await tenantDoc.save();
      return res.json({ ok: true, url: tenantDoc.settings.branding.logoUrl });
    } catch (err) {
      console.error("uploadLogo:", err);
      return res
        .status(500)
        .json({ ok: false, message: err.message || "Upload failed." });
    }
  },

  uploadCover: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);
      if (!req.file)
        return res.status(400).json({ ok: false, message: "No file." });

      const folder = `classic-academy/${tenantDoc.code}/cover`;
      const result = await uploadBuffer(req.file, folder, {
        resource_type: "image",
      });

      const oldPublicId = tenantDoc.settings?.branding?.coverPublicId;
      if (oldPublicId) await safeDestroy(oldPublicId, "image");

      tenantDoc.settings = tenantDoc.settings || {};
      tenantDoc.settings.branding = tenantDoc.settings.branding || {};
      tenantDoc.settings.branding.coverUrl = result.secure_url || result.url;
      tenantDoc.settings.branding.coverPublicId = result.public_id;

      await tenantDoc.save();
      return res.json({ ok: true, url: tenantDoc.settings.branding.coverUrl });
    } catch (err) {
      console.error("uploadCover:", err);
      return res
        .status(500)
        .json({ ok: false, message: err.message || "Upload failed." });
    }
  },

  uploadGallery: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);

      // ✅ Accept all multer shapes (array, fields, single)
      let files = [];
      if (req.files && Array.isArray(req.files.gallery))
        files = req.files.gallery;
      else if (req.files && Array.isArray(req.files.images))
        files = req.files.images;
      else if (Array.isArray(req.files)) files = req.files;
      else if (req.file) files = [req.file];

      if (!files.length) {
        return res.status(400).json({
          ok: false,
          message:
            "No files received. Ensure multer uses upload.array('gallery') and input name='gallery'.",
        });
      }

      tenantDoc.settings = tenantDoc.settings || {};
      tenantDoc.settings.profile = tenantDoc.settings.profile || {};
      const p = tenantDoc.settings.profile;

      if (!Array.isArray(p.gallery)) p.gallery = [];
      normalizeGallery(p);

      const folder = `classic-academy/${tenantDoc.code}/gallery`;

      for (let i = 0; i < files.length; i++) {
        const f = files[i];

        // ✅ If this triggers, your multer storage is not memoryStorage
        if (!f || !f.buffer) {
          return res.status(400).json({
            ok: false,
            message:
              "Uploaded file has no buffer. Use multer.memoryStorage() for gallery uploads.",
          });
        }

        // optional safety: only images
        const mt = String(f.mimetype || "");
        if (mt.indexOf("image/") !== 0) {
          return res.status(400).json({
            ok: false,
            message: "Only image files are allowed.",
          });
        }

        const result = await uploadBuffer(f, folder, {
          resource_type: "image",
        });

        p.gallery.push({
          url: result.secure_url || result.url,
          publicId: result.public_id,
          caption: "",
          sort: p.gallery.length,
          uploadedAt: new Date(),
        });
      }

      await tenantDoc.save();
      return res.json({ ok: true, count: files.length });
    } catch (err) {
      console.error("uploadGallery error:", err);

      return res.status(500).json({
        ok: false,
        message: err && err.message ? err.message : "Upload failed",
        http_code: err && err.http_code ? err.http_code : undefined,
      });
    }
  },

  deleteGalleryItem: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);
      const itemId = req.params.itemId;

      if (!mongoose.isValidObjectId(itemId)) {
        return res.status(400).json({ ok: false, message: "Invalid id." });
      }

      const p = tenantDoc.settings?.profile;
      if (!p || !Array.isArray(p.gallery)) return res.json({ ok: true });

      const item = p.gallery.id(itemId);
      if (!item)
        return res.status(404).json({ ok: false, message: "Not found." });

      const publicId = item.publicId;
      item.deleteOne();
      await tenantDoc.save();

      if (publicId) await safeDestroy(publicId, "image");
      return res.json({ ok: true });
    } catch (err) {
      console.error("deleteGallery:", err);
      return res
        .status(500)
        .json({ ok: false, message: err.message || "Delete failed." });
    }
  },

  // ✅ FAQ add/edit/delete
  addFaq: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);
      const q = String(req.body.q || "")
        .trim()
        .slice(0, 180);
      const a = String(req.body.a || "")
        .trim()
        .slice(0, 900);
      if (!q || !a)
        return res
          .status(400)
          .json({ ok: false, message: "Question and answer required." });

      tenantDoc.settings = tenantDoc.settings || {};
      tenantDoc.settings.profile = tenantDoc.settings.profile || {};
      const p = tenantDoc.settings.profile;

      if (!Array.isArray(p.faqs)) p.faqs = [];
      p.faqs.push({ q, a, sort: p.faqs.length });

      await tenantDoc.save();
      return res.json({ ok: true });
    } catch (err) {
      console.error("addFaq:", err);
      return res.status(500).json({ ok: false, message: "Failed" });
    }
  },

  editFaq: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);
      const id = req.params.faqId;

      if (!mongoose.isValidObjectId(id))
        return res.status(400).json({ ok: false, message: "Invalid id." });

      const q = String(req.body.q || "")
        .trim()
        .slice(0, 180);
      const a = String(req.body.a || "")
        .trim()
        .slice(0, 900);
      if (!q || !a)
        return res
          .status(400)
          .json({ ok: false, message: "Question and answer required." });

      const p = tenantDoc.settings?.profile;
      if (!p || !Array.isArray(p.faqs))
        return res
          .status(404)
          .json({ ok: false, message: "FAQ list missing." });

      const item = p.faqs.id(id);
      if (!item)
        return res.status(404).json({ ok: false, message: "FAQ not found." });

      item.q = q;
      item.a = a;

      await tenantDoc.save();
      return res.json({ ok: true });
    } catch (err) {
      console.error("editFaq:", err);
      return res.status(500).json({ ok: false, message: "Failed" });
    }
  },

  deleteFaq: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);
      const id = req.params.faqId;

      if (!mongoose.isValidObjectId(id))
        return res.status(400).json({ ok: false, message: "Invalid id." });

      const p = tenantDoc.settings?.profile;
      if (!p || !Array.isArray(p.faqs)) return res.json({ ok: true });

      const item = p.faqs.id(id);
      if (!item)
        return res.status(404).json({ ok: false, message: "Not found." });

      item.deleteOne();
      await tenantDoc.save();
      return res.json({ ok: true });
    } catch (err) {
      console.error("deleteFaq:", err);
      return res.status(500).json({ ok: false, message: "Failed" });
    }
  },

  // ✅ Review moderation (return JSON for fetch; redirect for normal)
  approveReview: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);
      const rid = req.params.reviewId;

      const r = tenantDoc.settings?.profile?.reviews?.id(rid);
      if (!r)
        return res.status(404).json({ ok: false, message: "Review not found" });

      r.status = "approved";
      r.approvedAt = new Date();
      await tenantDoc.save();

      if (wantsJson(req)) return res.json({ ok: true });
      return res.redirect("/admin/settings?success=1");
    } catch (err) {
      if (wantsJson(req))
        return res
          .status(500)
          .json({ ok: false, message: err.message || "Failed" });
      return res.status(500).send(err.message || "Failed");
    }
  },

  rejectReview: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);
      const rid = req.params.reviewId;

      const r = tenantDoc.settings?.profile?.reviews?.id(rid);
      if (!r)
        return res.status(404).json({ ok: false, message: "Review not found" });

      r.status = "rejected";
      await tenantDoc.save();

      if (wantsJson(req)) return res.json({ ok: true });
      return res.redirect("/admin/settings?success=1");
    } catch (err) {
      if (wantsJson(req))
        return res
          .status(500)
          .json({ ok: false, message: err.message || "Failed" });
      return res.status(500).send(err.message || "Failed");
    }
  },

  toggleFeaturedReview: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);
      const rid = req.params.reviewId;

      const r = tenantDoc.settings?.profile?.reviews?.id(rid);
      if (!r)
        return res.status(404).json({ ok: false, message: "Review not found" });

      r.featured = !r.featured;
      await tenantDoc.save();

      if (wantsJson(req)) return res.json({ ok: true });
      return res.redirect("/admin/settings?success=1");
    } catch (err) {
      if (wantsJson(req))
        return res
          .status(500)
          .json({ ok: false, message: err.message || "Failed" });
      return res.status(500).send(err.message || "Failed");
    }
  },

  deleteReview: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);
      const rid = req.params.reviewId;

      const r = tenantDoc.settings?.profile?.reviews?.id(rid);
      if (!r)
        return res.status(404).json({ ok: false, message: "Review not found" });

      r.deleteOne();
      await tenantDoc.save();

      if (wantsJson(req)) return res.json({ ok: true });
      return res.redirect("/admin/settings?success=1");
    } catch (err) {
      if (wantsJson(req))
        return res
          .status(500)
          .json({ ok: false, message: err.message || "Failed" });
      return res.status(500).send(err.message || "Failed");
    }
  },

  // ✅ Public submit review (THIS is what creates pending reviews)
  submitPublicReview: async (req, res) => {
    try {
      const code = safeLower(req.params.code);
      const tenantDoc = await Tenant.findOne({
        code,
        isDeleted: { $ne: true },
      });
      if (!tenantDoc)
        return res.status(404).json({ ok: false, message: "School not found" });

      const name = String(req.body.name || "")
        .trim()
        .slice(0, 60);
      const email = safeLower(req.body.email || "").slice(0, 120);
      const rating = Number(req.body.rating);
      const title = String(req.body.title || "")
        .trim()
        .slice(0, 80);
      const message = String(req.body.message || "")
        .trim()
        .slice(0, 1200);

      if (!name)
        return res
          .status(400)
          .json({ ok: false, message: "Name is required." });
      if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
        return res
          .status(400)
          .json({ ok: false, message: "Rating must be 1–5." });
      }

      tenantDoc.settings = tenantDoc.settings || {};
      tenantDoc.settings.profile = tenantDoc.settings.profile || {};
      tenantDoc.settings.profile.reviews =
        tenantDoc.settings.profile.reviews || [];

      tenantDoc.settings.profile.reviews.push({
        name,
        email,
        rating,
        title,
        message,
        status: "pending",
        featured: false,
        ipHash: ipHash(req.ip),
        userAgent: String(req.get("user-agent") || "").slice(0, 200),
        createdAt: new Date(),
      });

      await tenantDoc.save();
      return res.json({
        ok: true,
        message: "Thanks! Review submitted for approval.",
      });
    } catch (err) {
      console.error("submitPublicReview:", err);
      return res.status(500).json({ ok: false, message: "Failed to submit." });
    }
  },
};
