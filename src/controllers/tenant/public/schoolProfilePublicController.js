const crypto = require("crypto");
const { platformConnection, getTenantConnection } = require("../../../config/db");
const Tenant = require("../../../models/platform/Tenant")(platformConnection);
const loadTenantModels = require("../../../models/tenant/loadModels");

function safeInt(n, def = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : def;
}

function clean(s, max) {
  return String(s || "")
    .trim()
    .slice(0, max);
}

function parseWebsiteUrl(url) {
  const v = String(url || "").trim();
  if (!v) return "";
  if (!/^https?:\/\//i.test(v)) return "";
  return v;
}

function sha256(s) {
  return crypto.createHash("sha256").update(String(s || "")).digest("hex");
}

function ipHash(ip) {
  if (!ip) return "";
  return crypto.createHash("sha256").update(String(ip)).digest("hex");
}

function useLiveTenantProfile(req) {
  return process.env.PUBLIC_PROFILE_LIVE_TENANT_DB === "1" || String(req.query.live || "") === "1";
}

async function getTenantModels(req, tenantDoc) {
  if (req.models) return req.models;
  if (!tenantDoc?.dbName) return {};

  const conn = await getTenantConnection(tenantDoc.dbName);
  return loadTenantModels(conn);
}

async function computeCounts(models = {}) {
  const { Student, Staff, Subject } = models || {};

  const [students, staff, subjects] = await Promise.all([
    Student?.countDocuments?.({ isDeleted: { $ne: true } }) ?? 0,
    Staff?.countDocuments?.({ isDeleted: { $ne: true } }) ?? 0,
    Subject?.countDocuments?.({ status: { $ne: "archived" } }) ?? 0,
  ]);

  return { students, staff, subjects };
}

async function loadSubjects(models = {}, profile = {}) {
  const { Subject } = models || {};

  if (!Subject) {
    const items = Array.isArray(profile.subjects)
      ? profile.subjects
      : Array.isArray(profile.extraSubjects)
        ? profile.extraSubjects
        : [];

    return items.map((subject) => ({
      title: subject.title || subject.name || String(subject || "Subject"),
      desc: subject.desc || subject.description || "",
      level: subject.level || subject.className || subject.category || "-",
      duration: subject.duration || subject.academicYear || "-",
      hay: [
        typeof subject === "string" ? subject : "",
        subject.title,
        subject.name,
        subject.desc,
        subject.description,
        subject.level,
        subject.className,
        subject.category,
        subject.academicYear,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    }));
  }

  const rows = await Subject.find({ status: { $ne: "archived" } })
    .sort({ title: 1, code: 1 })
    .limit(80)
    .select("title code shortTitle description objectives schoolUnitName campusName className classLevel category weeklyPeriods academicYear term")
    .lean();

  return rows.map((subject) => ({
    title: subject.title || subject.code || "Subject",
    desc: subject.description || subject.objectives || "",
    level: [subject.classLevel, subject.className].filter(Boolean).join(" - ") || subject.category || "-",
    duration: [
      subject.academicYear,
      subject.term ? `Term ${subject.term}` : "",
      subject.weeklyPeriods ? `${subject.weeklyPeriods} periods/week` : "",
    ].filter(Boolean).join(" - ") || "-",
    hay: [
      subject.title,
      subject.code,
      subject.shortTitle,
      subject.description,
      subject.objectives,
      subject.schoolUnitName,
      subject.campusName,
      subject.className,
      subject.classLevel,
      subject.category,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
  }));
}

function loadFaqFromProfile(profile) {
  const faqs = Array.isArray(profile.faqs) ? profile.faqs : [];
  return faqs.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
}

function loadNewsFromProfile(profile) {
  const anns = Array.isArray(profile.announcements)
    ? profile.announcements
    : [];

  return anns
    .slice()
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

function loadApprovedReviewsFromProfile(profile) {
  const all = Array.isArray(profile.reviews) ? profile.reviews : [];

  const approvedAll = all
    .filter(
      (r) =>
        String(r.status || "")
          .trim()
          .toLowerCase() === "approved",
    )
    .sort(
      (a, b) =>
        (b.featured ? 1 : 0) - (a.featured ? 1 : 0) ||
        new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
    );

  const count = approvedAll.length;
  const avg = count
    ? approvedAll.reduce((sum, r) => sum + (Number(r.rating) || 0), 0) / count
    : 0;

  const items = approvedAll.slice(0, 12);

  return { items, avg: Math.round(avg * 10) / 10, count };
}

function normalizeAdmissions(profile) {
  const a = profile.admissions || {};

  return {
    steps: Array.isArray(a.steps) ? a.steps.filter(Boolean) : [],
    requiredDocs: Array.isArray(a.requiredDocs)
      ? a.requiredDocs.filter(Boolean)
      : [],
    feesRange: clean(a.feesRange || profile.feesRange || "", 120),
    paymentOptions: clean(a.paymentOptions || profile.paymentOptions || "", 200),
    applyUrl: parseWebsiteUrl(a.applyUrl || profile.applyUrl || ""),
    requirements: clean(a.requirements || profile.requirements || "", 2000),
    officeHours: clean(a.officeHours || profile.officeHours || "", 200),
    intakeLabel: clean(a.intakeLabel || profile.intakeLabel || "", 120),
    applicationFeeText: clean(
      a.applicationFeeText || profile.applicationFeeText || "",
      120,
    ),
    admissionPhone: clean(a.admissionPhone || profile.admissionPhone || "", 60),
    isOpen:
      typeof a.isOpen === "boolean"
        ? a.isOpen
        : typeof profile.admissionsOpen === "boolean"
          ? profile.admissionsOpen
          : true,
  };
}

async function findTenantForPublicPage(req, code) {
  if (req.tenant && String(req.tenant.code || "").toLowerCase() === code) {
    return req.tenant;
  }

  return Tenant.findOne({
    code,
    isDeleted: { $ne: true },
  })
    .select("name code dbName settings status planName createdAt updatedAt")
    .lean();
}

module.exports = {
  // GET /schools/:code
  async page(req, res) {
    try {
      const code = String(req.params.code || "")
        .trim()
        .toLowerCase();

      const tenantDoc = await findTenantForPublicPage(req, code);

      if (!tenantDoc) {
        return res.status(404).render("errors/404");
      }

      const profile = tenantDoc.settings?.profile || {};
      const branding = tenantDoc.settings?.branding || {};

      if (profile.enabled === false) {
        return res.status(404).render("errors/404");
      }

      const tenantModels = useLiveTenantProfile(req) ? await getTenantModels(req, tenantDoc) : {};
      const counts = await computeCounts(tenantModels);
      const subjects = await loadSubjects(tenantModels, {
        ...profile,
        extraSubjects: tenantDoc.settings?.academics?.extraSubjects,
      });
      const faqs = loadFaqFromProfile(profile);
      const announcements = loadNewsFromProfile(profile);
      const reviews = loadApprovedReviewsFromProfile(profile);
      const admissions = normalizeAdmissions(profile);

      const stats = {
        students: safeInt(profile.stats?.students, counts.students),
        subjects: safeInt(profile.stats?.subjects ?? profile.stats?.programs, counts.subjects),
        staff: safeInt(profile.stats?.staff, counts.staff),
        campuses: safeInt(profile.stats?.campuses, 0),
      };

      const whyChooseUsArr =
        Array.isArray(profile.highlights) && profile.highlights.length
          ? profile.highlights
          : Array.isArray(profile.whyChooseUs)
            ? profile.whyChooseUs
            : [];

      const normalizedLocation = profile.location || {};
      const normalizedContact = profile.contact || {};
      const normalizedSocials = profile.socials || {};
      const normalizedCity = clean(
        profile.city || normalizedLocation.city || "",
        100,
      );

      return res.render("tenant/public/schools/school-profile", {
        tenant: {
          ...tenantDoc,
          settings: {
            ...tenantDoc.settings,
            branding: {
              ...branding,
              primaryColor: branding.primaryColor || "#0a3d62",
              accentColor: branding.accentColor || "#0a6fbf",
            },
            profile: {
              ...profile,
              enabled: profile.enabled !== false,
              verified: !!profile.verified,

              city: normalizedCity,
              location: normalizedLocation,
              contact: normalizedContact,
              socials: normalizedSocials,

              stats,
              admissions,

              facilities: Array.isArray(profile.facilities)
                ? profile.facilities
                : [],
              values: Array.isArray(profile.values) ? profile.values : [],
              whyChooseUs: whyChooseUsArr,
              gallery: Array.isArray(profile.gallery) ? profile.gallery : [],
              awards: Array.isArray(profile.awards) ? profile.awards : [],
              announcements,
              faqs,

              reviews: reviews.items,
              ratingAvg: reviews.avg,
              ratingCount: reviews.count,

              subjects,
              websiteSafe: parseWebsiteUrl(normalizedContact.website || ""),
              addressSafe: clean(
                profile.address ||
                  normalizedContact.addressFull ||
                  normalizedLocation.addressLine1 ||
                  "",
                200,
              ),
            },
          },
        },
      });
    } catch (e) {
      console.error("public school profile:", e);
      return res.status(500).render("errors/500");
    }
  },

  // POST /schools/:code/inquiry
  async inquiry(req, res) {
    try {
      const { SchoolInquiry } = req.models || {};
      const code = String(req.params.code || "")
        .trim()
        .toLowerCase();

      const name = clean(req.body.name, 100);
      const contact = clean(req.body.contact, 120);
      const message = clean(req.body.message, 2000);

      if (!name) {
        return res
          .status(400)
          .json({ ok: false, message: "Full name is required." });
      }

      if (!contact) {
        return res
          .status(400)
          .json({ ok: false, message: "Phone/Email is required." });
      }

      if (!message) {
        return res
          .status(400)
          .json({ ok: false, message: "Message is required." });
      }

      if (!SchoolInquiry) {
        return res.json({
          ok: true,
          message: "Message submitted ✅",
        });
      }

      const saved = await SchoolInquiry.create({
        schoolCode: code,
        name,
        contact,
        message,
        status: "new",
        ipHash: sha256(req.ip),
        userAgent: clean(req.get("user-agent") || "", 200),
      });

      return res.json({
        ok: true,
        message: "Message submitted ✅",
        inquiryId: saved?._id || null,
      });
    } catch (e) {
      console.error("inquiry:", e);
      return res.status(500).json({ ok: false, message: "Server error" });
    }
  },

  // POST /schools/:code/reviews
  async review(req, res) {
    try {
      const code = String(req.params.code || "")
        .trim()
        .toLowerCase();

      const tenant = await Tenant.findOne({
        code,
        isDeleted: { $ne: true },
      });

      if (!tenant) {
        return res
          .status(404)
          .json({ ok: false, message: "School not found." });
      }

      const name = clean(req.body.name, 80);
      const email = clean(req.body.email, 120).toLowerCase();
      const rating = Number(req.body.rating);
      const title = clean(req.body.title, 80);
      const message = clean(req.body.message, 1200);

      if (!name) {
        return res
          .status(400)
          .json({ ok: false, message: "Name is required." });
      }

      if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
        return res
          .status(400)
          .json({ ok: false, message: "Rating must be 1–5." });
      }

      tenant.settings = tenant.settings || {};
      tenant.settings.profile = tenant.settings.profile || {};
      tenant.settings.profile.reviews = tenant.settings.profile.reviews || [];

      tenant.settings.profile.reviews.push({
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

      tenant.markModified("settings.profile.reviews");
      await tenant.save();

      return res.json({
        ok: true,
        message: "Review submitted ✅ (pending approval)",
      });
    } catch (e) {
      console.error("review:", e);
      return res.status(500).json({ ok: false, message: "Server error" });
    }
  },
};
