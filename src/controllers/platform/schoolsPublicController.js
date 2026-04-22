const crypto = require("crypto");
const { platformConnection, getTenantConnection } = require("../../config/db");
const Tenant = require("../../models/platform/Tenant")(platformConnection);
const loadTenantModels = require("../../models/tenant/loadModels");

function safeInt(n, def = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : def;
}

function clean(s, max) {
  return String(s || "").trim().slice(0, max);
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

function escapeRegex(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function buildSchoolListBaseFilter() {
  return {
    isDeleted: { $ne: true },
    "settings.profile.enabled": { $ne: false },
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

function buildChipFilter(chip) {
  const normalized = clean(chip, 40).toLowerCase();

  if (!normalized || normalized === "all") return null;

  if (normalized === "verified") {
    return { "settings.profile.verified": true };
  }

  if (normalized === "boarding") {
    return { "settings.profile.system": { $regex: /boarding/i } };
  }

  if (normalized === "day") {
    return { "settings.profile.system": { $regex: /day/i } };
  }

  if (normalized === "science") {
    return {
      $or: [
        { "settings.academics.extraSubjects": { $regex: /science/i } },
        { "settings.profile.tagline": { $regex: /science/i } },
        { "settings.profile.highlights": { $regex: /science/i } },
        { "settings.profile.facilities": { $regex: /science/i } },
      ],
    };
  }

  if (normalized === "ict") {
    return {
      $or: [
        { "settings.academics.extraSubjects": { $regex: /(ict|computer|technology)/i } },
        { "settings.profile.tagline": { $regex: /(ict|computer|technology)/i } },
        { "settings.profile.highlights": { $regex: /(ict|computer|technology)/i } },
        { "settings.profile.facilities": { $regex: /(ict|computer|technology)/i } },
      ],
    };
  }

  return null;
}

module.exports = {
  // GET /schools
  async list(req, res) {
    try {
      const q = clean(req.query.q, 120);
      const city = clean(req.query.city, 100);
      const type = clean(req.query.type, 100);
      const chip = clean(req.query.chip || "all", 40).toLowerCase() || "all";
      const verified = String(req.query.verified || "") === "1";
      const rawSort = clean(req.query.sort || "rank", 40) || "rank";
      const sort = rawSort === "programs" ? "subjects" : rawSort;

      const page = Math.max(parseInt(req.query.page || "1", 10) || 1, 1);
      const limit = Math.min(
        Math.max(parseInt(req.query.limit || "12", 10) || 12, 1),
        48,
      );
      const skip = (page - 1) * limit;

      const filter = buildSchoolListBaseFilter();

      if (city) {
        filter["settings.profile.location.city"] = city;
      }

      if (type) {
        filter["settings.profile.type"] = type;
      }

      if (verified) {
        filter["settings.profile.verified"] = true;
      }

      if (q) {
        const rx = new RegExp(escapeRegex(q), "i");
        filter.$or = [
          { name: rx },
          { code: rx },
          { "settings.profile.shortName": rx },
          { "settings.profile.type": rx },
          { "settings.profile.tagline": rx },
          { "settings.profile.system": rx },
          { "settings.profile.location.city": rx },
          { "settings.profile.location.country": rx },
          { "settings.profile.highlights": rx },
          { "settings.profile.facilities": rx },
          { "settings.profile.clubs": rx },
          { "settings.academics.extraSubjects": rx },
        ];
      }

      const chipFilter = buildChipFilter(chip);
      if (chipFilter) {
        filter.$and = filter.$and || [];
        filter.$and.push(chipFilter);
      }

      let sortObj = { createdAt: -1 };

      if (sort === "name") {
        sortObj = { name: 1 };
      } else if (sort === "students") {
        sortObj = {
          "settings.profile.stats.students": -1,
          name: 1,
        };
      } else if (sort === "subjects") {
        sortObj = {
          "settings.profile.stats.subjects": -1,
          "settings.profile.stats.programs": -1,
          name: 1,
        };
      } else {
        sortObj = {
          "settings.profile.verified": -1,
          "settings.profile.ratingSummary.avg": -1,
          "settings.profile.stats.students": -1,
          createdAt: -1,
        };
      }

      const projection = {
        name: 1,
        code: 1,
        "settings.branding.logoUrl": 1,
        "settings.branding.coverUrl": 1,
        "settings.profile.shortName": 1,
        "settings.profile.type": 1,
        "settings.profile.tagline": 1,
        "settings.profile.system": 1,
        "settings.profile.verified": 1,
        "settings.profile.location.city": 1,
        "settings.profile.location.country": 1,
        "settings.profile.contact.phone": 1,
        "settings.profile.contact.website": 1,
        "settings.profile.admissions.applyUrl": 1,
        "settings.profile.stats": 1,
        "settings.profile.ratingSummary": 1,
        "settings.profile.awards": 1,
        "settings.profile.highlights": 1,
        "settings.profile.stats.subjects": 1,
        "settings.academics.extraSubjects": 1,
      };

      const baseFilter = buildSchoolListBaseFilter();

      const [items, total, totalAll, cities, types] = await Promise.all([
        Tenant.find(filter)
          .select(projection)
          .sort(sortObj)
          .skip(skip)
          .limit(limit)
          .lean(),

        Tenant.countDocuments(filter),

        Tenant.countDocuments(baseFilter),

        Tenant.distinct("settings.profile.location.city", baseFilter),

        Tenant.distinct("settings.profile.type", baseFilter),
      ]);

      return res.render("platform/public/schools", {
        items,
        q,
        city,
        type,
        chip,
        verified,
        sort,
        page,
        pages: Math.max(1, Math.ceil(total / limit)),
        baseDomain: process.env.BASE_DOMAIN || "classicacademy.app",
        total,
        totalAll,
        limit,
        cities: cities.filter(Boolean).sort(),
        types: types.filter(Boolean).sort(),
      });
    } catch (e) {
      console.error("public school list:", e);
      return res.status(500).render("errors/500");
    }
  },

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

      return res.render("platform/public/school-profile", {
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
      const code = String(req.params.code || "").trim().toLowerCase();

      const name = clean(req.body.name, 100);
      const contact = clean(req.body.contact, 120);
      const message = clean(req.body.message, 2000);

      if (!name) {
        return res.status(400).json({ ok: false, message: "Full name is required." });
      }

      if (!contact) {
        return res.status(400).json({ ok: false, message: "Phone/Email is required." });
      }

      if (!message) {
        return res.status(400).json({ ok: false, message: "Message is required." });
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
      const code = String(req.params.code || "").trim().toLowerCase();

      const tenant = await Tenant.findOne({
        code,
        isDeleted: { $ne: true },
      });

      if (!tenant) {
        return res.status(404).json({ ok: false, message: "School not found." });
      }

      const name = clean(req.body.name, 80);
      const email = clean(req.body.email, 120).toLowerCase();
      const rating = Number(req.body.rating);
      const title = clean(req.body.title, 80);
      const message = clean(req.body.message, 1200);

      if (!name) {
        return res.status(400).json({ ok: false, message: "Name is required." });
      }

      if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ ok: false, message: "Rating must be 1–5." });
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
