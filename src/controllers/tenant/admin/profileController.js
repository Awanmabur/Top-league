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

function safeLower(v) {
  if (Array.isArray(v)) v = v[v.length - 1];
  return String(v || "").trim().toLowerCase();
}

function str(v) {
  if (Array.isArray(v)) v = v[v.length - 1];
  return String(v ?? "").trim();
}

function csvToArray(v) {
  if (Array.isArray(v)) v = v[v.length - 1];
  return String(v || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function linesToArray(v) {
  if (Array.isArray(v)) v = v[v.length - 1];
  return String(v || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}

function ipHash(ip) {
  if (!ip) return "";
  return crypto.createHash("sha256").update(String(ip)).digest("hex");
}

function wantsJson(req) {
  return (
    req.xhr ||
    (req.get("accept") || "").includes("application/json") ||
    req.get("x-requested-with") === "XMLHttpRequest"
  );
}

function actorUserId(req) {
  return req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;
}

function formatDateTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function parseAwards(text) {
  return linesToArray(text)
    .map((row) => row.split("|").map((x) => x.trim()))
    .filter((parts) => parts[0])
    .map((parts, idx) => ({
      title: parts[0],
      organization: parts[1] || "",
      year: parts[2] ? Number(parts[2]) : undefined,
      description: parts[3] || "",
      sort: idx,
    }));
}

function parseNews(text) {
  return linesToArray(text)
    .map((row) => row.split("|").map((x) => x.trim()))
    .filter((parts) => parts[0])
    .map((parts, idx) => ({
      title: parts[0],
      date: parts[1] ? new Date(parts[1]) : new Date(),
      body: parts[2] || "",
      pinned: false,
      isPublished: true,
      sort: idx,
    }));
}

function normalizeGallery(profile) {
  if (!Array.isArray(profile.gallery)) profile.gallery = [];

  profile.gallery = profile.gallery
    .map((g, idx) => {
      if (!g || !g.url || !g.publicId) return null;

      return {
        _id: g._id || new mongoose.Types.ObjectId(),
        url: String(g.url),
        publicId: String(g.publicId),
        caption: String(g.caption || ""),
        sort: Number.isFinite(Number(g.sort)) ? Number(g.sort) : idx,
        uploadedAt: g.uploadedAt ? new Date(g.uploadedAt) : new Date(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));
}

function calculateRatingSummary(reviews) {
  const approved = (reviews || []).filter(
    (r) => r && r.status === "approved" && Number(r.rating) >= 1
  );

  if (!approved.length) {
    return { avg: 0, count: 0 };
  }

  const total = approved.reduce((sum, r) => sum + Number(r.rating || 0), 0);
  return {
    avg: Number((total / approved.length).toFixed(1)),
    count: approved.length,
  };
}

function friendlyUploadError(err, fallback) {
  const msg = String(err?.message || "").toLowerCase();
  const code = String(err?.code || "").toUpperCase();

  if (
    code === "LIMIT_FILE_SIZE" ||
    msg.includes("file too large") ||
    msg.includes("payload too large")
  ) {
    return "Upload failed: image is too large. Please choose a smaller file and try again.";
  }

  if (code === "LIMIT_UNEXPECTED_FILE" || msg.includes("unexpected field")) {
    return "Upload failed: invalid upload field received. Please refresh the page and try again.";
  }

  if (msg.includes("only image files are allowed")) {
    return "Upload failed: only image files are allowed.";
  }

  if (msg.includes("buffer")) {
    return "Upload failed: server did not receive the file correctly. Please try again.";
  }

  return fallback || err?.message || "Upload failed.";
}

function ensureTenantShape(tenantDoc) {
  if (!tenantDoc.settings) tenantDoc.settings = {};
  if (!tenantDoc.settings.branding) tenantDoc.settings.branding = {};
  if (!tenantDoc.settings.profile) tenantDoc.settings.profile = {};
  if (!tenantDoc.settings.preferences) tenantDoc.settings.preferences = {};
  if (!tenantDoc.settings.academics) tenantDoc.settings.academics = {};
  if (!Array.isArray(tenantDoc.settings.modules)) tenantDoc.settings.modules = [];
  if (!tenantDoc.meta) tenantDoc.meta = {};

  if (!Array.isArray(tenantDoc.settings.academics.schoolUnits)) {
    tenantDoc.settings.academics.schoolUnits = [];
  }

  const branding = tenantDoc.settings.branding;
  const profile = tenantDoc.settings.profile;
  const prefs = tenantDoc.settings.preferences;

  if (!profile.contact) profile.contact = {};
  if (!profile.socials) profile.socials = {};
  if (!profile.location) profile.location = {};
  if (!profile.admissions) profile.admissions = {};
  if (!profile.stats) profile.stats = {};
  if (!profile.ratingSummary) profile.ratingSummary = { avg: 0, count: 0 };
  if (!profile.seo) profile.seo = {};

  if (!Array.isArray(profile.values)) profile.values = [];
  if (!Array.isArray(profile.facilities)) profile.facilities = [];
  if (!Array.isArray(profile.accreditations)) profile.accreditations = [];
  if (!Array.isArray(profile.clubs)) profile.clubs = [];
  if (!Array.isArray(profile.scholarships)) profile.scholarships = [];
  if (!Array.isArray(profile.policies)) profile.policies = [];
  if (!Array.isArray(profile.highlights)) profile.highlights = [];
  if (!Array.isArray(profile.whyChooseUs)) profile.whyChooseUs = [];
  if (!Array.isArray(profile.gallery)) profile.gallery = [];
  if (!Array.isArray(profile.awards)) profile.awards = [];
  if (!Array.isArray(profile.announcements)) profile.announcements = [];
  if (!Array.isArray(profile.faqs)) profile.faqs = [];
  if (!Array.isArray(profile.reviews)) profile.reviews = [];
  if (!Array.isArray(profile.seo.keywords)) profile.seo.keywords = [];

  if (!Array.isArray(profile.admissions.steps)) profile.admissions.steps = [];
  if (!Array.isArray(profile.admissions.requiredDocs)) profile.admissions.requiredDocs = [];
  profile.admissions.feesRange = profile.admissions.feesRange || profile.feesRange || "";
  profile.admissions.paymentOptions = profile.admissions.paymentOptions || profile.paymentOptions || "";

  branding.logoUrl = branding.logoUrl || "";
  branding.logoPublicId = branding.logoPublicId || "";
  branding.faviconUrl = branding.faviconUrl || "";
  branding.faviconPublicId = branding.faviconPublicId || "";
  branding.coverUrl = branding.coverUrl || "";
  branding.coverPublicId = branding.coverPublicId || "";
  branding.primaryColor = branding.primaryColor || "#0a3d62";
  branding.accentColor = branding.accentColor || "#0a6fbf";
  branding.secondaryColor = branding.secondaryColor || "#083454";
  branding.textColor = branding.textColor || "#0f172a";
  branding.buttonRadius =
    Number.isFinite(Number(branding.buttonRadius)) ? Number(branding.buttonRadius) : 14;

  profile.enabled = profile.enabled !== false;
  profile.verified = !!profile.verified;
  profile.type = profile.type || "";
  profile.shortName = profile.shortName || "";
  profile.tagline = profile.tagline || "";
  profile.motto = profile.motto || "";
  profile.system = profile.system || "";
  profile.ownership = profile.ownership || "";
  profile.category = profile.category || "";
  profile.about = profile.about || "";
  profile.mission = profile.mission || "";
  profile.vision = profile.vision || "";
  profile.city = profile.city || profile.location.city || "";

  profile.contact.phone = profile.contact.phone || "";
  profile.contact.altPhone = profile.contact.altPhone || "";
  profile.contact.email = profile.contact.email || "";
  profile.contact.admissionsEmail = profile.contact.admissionsEmail || "";
  profile.contact.billingEmail = profile.contact.billingEmail || "";
  profile.contact.website = profile.contact.website || "";
  profile.contact.addressFull = profile.contact.addressFull || "";
  profile.contact.postalAddress = profile.contact.postalAddress || "";

  profile.socials.facebook = profile.socials.facebook || "";
  profile.socials.instagram = profile.socials.instagram || "";
  profile.socials.x = profile.socials.x || "";
  profile.socials.youtube = profile.socials.youtube || "";
  profile.socials.tiktok = profile.socials.tiktok || "";
  profile.socials.linkedin = profile.socials.linkedin || "";
  profile.socials.whatsapp = profile.socials.whatsapp || "";

  profile.location.country = profile.location.country || tenantDoc.country || "";
  profile.location.city = profile.location.city || profile.city || "";
  profile.location.district = profile.location.district || "";
  profile.location.addressLine1 = profile.location.addressLine1 || "";
  profile.location.addressLine2 = profile.location.addressLine2 || "";
  profile.location.googleMapUrl = profile.location.googleMapUrl || "";

  if (!profile.admissions.applyUrl && profile.applyUrl) {
    profile.admissions.applyUrl = profile.applyUrl;
  }
  if (!profile.admissions.requirements && profile.requirements) {
    profile.admissions.requirements = profile.requirements;
  }
  if (!profile.admissions.officeHours && profile.officeHours) {
    profile.admissions.officeHours = profile.officeHours;
  }
  if (!profile.admissions.intakeLabel && profile.intakeLabel) {
    profile.admissions.intakeLabel = profile.intakeLabel;
  }
  if (!profile.admissions.applicationFeeText && profile.applicationFeeText) {
    profile.admissions.applicationFeeText = profile.applicationFeeText;
  }
  if (!profile.admissions.admissionPhone && profile.admissionPhone) {
    profile.admissions.admissionPhone = profile.admissionPhone;
  }
  if (
    typeof profile.admissions.isOpen !== "boolean" &&
    typeof profile.admissionsOpen === "boolean"
  ) {
    profile.admissions.isOpen = profile.admissionsOpen;
  }

  profile.admissions.applyUrl = profile.admissions.applyUrl || "";
  profile.admissions.requirements = profile.admissions.requirements || "";
  profile.admissions.officeHours = profile.admissions.officeHours || "";
  profile.admissions.intakeLabel = profile.admissions.intakeLabel || "";
  profile.admissions.applicationFeeText = profile.admissions.applicationFeeText || "";
  profile.admissions.admissionPhone = profile.admissions.admissionPhone || "";
  profile.admissions.isOpen = profile.admissions.isOpen !== false;

  profile.stats.students = Number(profile.stats.students || 0);
  profile.stats.subjects = Number(profile.stats.subjects || profile.stats.programs || 0);
  delete profile.stats.programs;
  profile.stats.staff = Number(profile.stats.staff || 0);
  profile.stats.campuses = Number(profile.stats.campuses || 0);
  profile.stats.alumni = Number(profile.stats.alumni || 0);

  profile.seo.metaTitle = profile.seo.metaTitle || "";
  profile.seo.metaDescription = profile.seo.metaDescription || "";
  profile.seo.ogImageUrl = profile.seo.ogImageUrl || "";
  profile.seo.canonicalUrl = profile.seo.canonicalUrl || "";
  profile.seo.indexable = profile.seo.indexable !== false;
  profile.seo.structuredDataEnabled = profile.seo.structuredDataEnabled !== false;

  prefs.allowPublicProfile = prefs.allowPublicProfile !== false;
  prefs.allowReviews = prefs.allowReviews !== false;
  prefs.showContactForm = prefs.showContactForm !== false;
  prefs.showGallery = prefs.showGallery !== false;

  tenantDoc.meta.notes = tenantDoc.meta.notes || "";
  tenantDoc.meta.domainStatus = tenantDoc.meta.domainStatus || "not_configured";
  tenantDoc.meta.sslStatus = tenantDoc.meta.sslStatus || "not_applicable";
  tenantDoc.meta.onboardingCompleted = !!tenantDoc.meta.onboardingCompleted;
  tenantDoc.meta.onboardingStep = Number(tenantDoc.meta.onboardingStep || 0);
  tenantDoc.meta.provisioningVersion = Number(tenantDoc.meta.provisioningVersion || 1);

  normalizeGallery(profile);
}

async function getTenantFromReq(req) {
  const code =
    req?.tenant?.code ||
    req?.session?.tenantCode ||
    safeLower(req?.headers?.host || "").split(".")[0];

  if (!code) throw new Error("Tenant code missing.");

  const tenantDoc = await Tenant.findOne({
    code: safeLower(code),
    isDeleted: { $ne: true },
  });

  if (!tenantDoc) throw new Error("Tenant not found.");

  ensureTenantShape(tenantDoc);
  return tenantDoc;
}

function getSchoolUnits(tenantDoc) {
  if (!tenantDoc.settings) tenantDoc.settings = {};
  if (!tenantDoc.settings.academics) tenantDoc.settings.academics = {};
  if (!Array.isArray(tenantDoc.settings.academics.schoolUnits)) {
    tenantDoc.settings.academics.schoolUnits = [];
  }
  return tenantDoc.settings.academics.schoolUnits;
}

function getSelectedSchoolUnitId(req) {
  return str(req?.body?.schoolUnitId || req?.query?.schoolUnitId || "");
}

function getSelectedSchoolUnit(tenantDoc, req) {
  const schoolUnits = getSchoolUnits(tenantDoc);
  const requestedId = getSelectedSchoolUnitId(req);
  const selected = requestedId
    ? schoolUnits.find((unit) => String(unit._id) === requestedId)
    : schoolUnits[0];
  return selected || null;
}

function schoolUnitHasProfileData(schoolUnit) {
  if (!schoolUnit) return false;

  const p = schoolUnit.profile || {};
  const b = schoolUnit.branding || {};

  return !!(
    str(p.type) ||
    str(p.shortName) ||
    str(p.tagline) ||
    str(p.about) ||
    str(p.mission) ||
    str(p.vision) ||
    str(p.city) ||
    str(p?.contact?.phone) ||
    str(p?.contact?.email) ||
    str(p?.location?.city) ||
    str(p?.location?.country) ||
    (Array.isArray(p.values) && p.values.length) ||
    (Array.isArray(p.gallery) && p.gallery.length) ||
    (Array.isArray(p.faqs) && p.faqs.length) ||
    (Array.isArray(p.reviews) && p.reviews.length) ||
    str(b.logoUrl) ||
    str(b.coverUrl) ||
    str(b.faviconUrl)
  );
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function seedSchoolUnitFromTenantIfEmpty(tenantDoc, schoolUnit) {
  if (!schoolUnit) return false;
  if (schoolUnitHasProfileData(schoolUnit)) return false;

  schoolUnit.profile = clonePlain(tenantDoc.settings?.profile || {});
  schoolUnit.branding = clonePlain(tenantDoc.settings?.branding || {});
  tenantDoc.markModified("settings.academics.schoolUnits");
  return true;
}

function mirrorSchoolUnitToTenantSettings(tenantDoc, schoolUnit) {
  if (!schoolUnit) return;

  tenantDoc.settings.profile = {
    ...(tenantDoc.settings.profile || {}),
    ...(schoolUnit.profile || {}),
    stats: {
      ...(tenantDoc.settings.profile?.stats || {}),
      ...(schoolUnit.profile?.stats || {}),
    },
  };

  tenantDoc.settings.branding = {
    ...(tenantDoc.settings.branding || {}),
    ...(schoolUnit.branding || {}),
  };

  ensureTenantShape(tenantDoc);
}

function syncTenantSettingsBackToSchoolUnit(tenantDoc, schoolUnit) {
  if (!schoolUnit) return;

  schoolUnit.profile = {
    ...(schoolUnit.profile || {}),
    ...(tenantDoc.settings.profile || {}),
    stats: {
      ...(schoolUnit.profile?.stats || {}),
      ...(tenantDoc.settings.profile?.stats || {}),
    },
  };

  schoolUnit.branding = {
    ...(schoolUnit.branding || {}),
    ...(tenantDoc.settings.branding || {}),
  };

  delete schoolUnit.profile?.stats?.programs;
  tenantDoc.markModified("settings.academics.schoolUnits");
}

function profileRedirectPath(schoolUnitId) {
  return schoolUnitId
    ? `/admin/profile?success=1&schoolUnitId=${encodeURIComponent(schoolUnitId)}`
    : "/admin/profile?success=1";
}

function shouldRefreshProfileStats(req) {
  return (
    process.env.ADMIN_PROFILE_LIVE_STATS === "1" ||
    String(req?.query?.refreshStats || "") === "1"
  );
}

function getProfileStatsSnapshot(tenantDoc, selectedSchoolUnit) {
  const profile = selectedSchoolUnit?.profile || tenantDoc.settings?.profile || {};
  const stats = profile.stats || {};

  return {
    students: Number(stats.students || 0),
    subjects: Number(stats.subjects || stats.programs || 0),
    staff: Number(stats.staff || 0),
    campuses: selectedSchoolUnit
      ? (selectedSchoolUnit.campuses || []).length
      : Number(stats.campuses || 0),
    alumni: Number(stats.alumni || 0),
  };
}

async function getStatsFromTenantDB(tenantDoc) {
  try {
    const conn = await getTenantConnection(tenantDoc.dbName);
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
      campuses: tenantDoc.settings?.profile?.stats?.campuses || 0,
      alumni: tenantDoc.settings?.profile?.stats?.alumni || 0,
    };
  } catch (_) {
    return {
      students: tenantDoc.settings?.profile?.stats?.students || 0,
      subjects: tenantDoc.settings?.profile?.stats?.subjects || tenantDoc.settings?.profile?.stats?.programs || 0,
      staff: tenantDoc.settings?.profile?.stats?.staff || 0,
      campuses: tenantDoc.settings?.profile?.stats?.campuses || 0,
      alumni: tenantDoc.settings?.profile?.stats?.alumni || 0,
    };
  }
}

function buildProfileStats(tenantDoc) {
  const p = tenantDoc.settings?.profile || {};
  const summary = p.ratingSummary || { avg: 0, count: 0 };

  return {
    completion: Number(tenantDoc.meta?.profileCompletion || 0),
    plan: tenantDoc.planName || "-",
    students: Number(p.stats?.students || 0),
    subjects: Number(p.stats?.subjects || p.stats?.programs || 0),
    staff: Number(p.stats?.staff || 0),
    campuses: Number(p.stats?.campuses || 0),
    alumni: Number(p.stats?.alumni || 0),
    rating: Number(summary.avg || 0),
    reviews: Number(summary.count || 0),
    status: tenantDoc.status || "trial",
    createdAtLabel: formatDateTime(tenantDoc.createdAt),
    updatedAtLabel: formatDateTime(tenantDoc.updatedAt),
  };
}

module.exports = {
  page: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);
      const selectedSchoolUnit = getSelectedSchoolUnit(tenantDoc, req);

      let seeded = false;
      if (selectedSchoolUnit) {
        seeded = seedSchoolUnitFromTenantIfEmpty(tenantDoc, selectedSchoolUnit);
        if (seeded) {
          await tenantDoc.save();
        }
        mirrorSchoolUnitToTenantSettings(tenantDoc, selectedSchoolUnit);
      }

      const liveStats = shouldRefreshProfileStats(req)
        ? await getStatsFromTenantDB(tenantDoc)
        : getProfileStatsSnapshot(tenantDoc, selectedSchoolUnit);
      tenantDoc.settings.profile.stats = {
        ...tenantDoc.settings.profile.stats,
        ...liveStats,
        campuses: selectedSchoolUnit
          ? (selectedSchoolUnit.campuses || []).length
          : liveStats.campuses,
      };

      tenantDoc.settings.profile.ratingSummary = calculateRatingSummary(
        tenantDoc.settings.profile.reviews
      );

      if (shouldRefreshProfileStats(req)) {
        tenantDoc.markModified("settings.profile.stats");
        tenantDoc.markModified("settings.profile.ratingSummary");
        await tenantDoc.save();
      }

      const reviews = tenantDoc.settings.profile.reviews || [];
      const pending = reviews.filter((r) => r.status === "pending");
      const approved = reviews.filter((r) => r.status === "approved");

      return res.render("tenant/profile/index", {
        tenant: tenantDoc.toObject(),
        pending,
        approved,
        profileStats: buildProfileStats(tenantDoc),
        success: req.query.success
          ? "Profile saved successfully ✅"
          : seeded
          ? "Legacy profile seeded into this school unit ✅"
          : null,
        error: null,
        schoolUnits: getSchoolUnits(tenantDoc).map((unit) => ({
          _id: String(unit._id),
          name: unit.name,
          category: unit.category || unit.type?.category || "",
          schoolType: unit.schoolType || unit.type?.schoolType || "",
        })),
        activeSchoolUnitId: selectedSchoolUnit ? String(selectedSchoolUnit._id) : "",
        csrfToken: req.csrfToken ? req.csrfToken() : null,
      });
    } catch (err) {
      console.error("profile page error:", err);
      return res.status(500).send(err.message || "Failed to load profile.");
    }
  },

  update: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);
      const selectedSchoolUnit = getSelectedSchoolUnit(tenantDoc, req);

      if (selectedSchoolUnit) {
        seedSchoolUnitFromTenantIfEmpty(tenantDoc, selectedSchoolUnit);
        mirrorSchoolUnitToTenantSettings(tenantDoc, selectedSchoolUnit);
      }

      const b = req.body || {};
      const p = tenantDoc.settings.profile;
      const c = p.contact;
      const s = p.socials;
      const l = p.location;
      const a = p.admissions;
      const seo = p.seo;
      const br = tenantDoc.settings.branding;
      const prefs = tenantDoc.settings.preferences;

      tenantDoc.planName = str(b.planName || tenantDoc.planName);
      tenantDoc.customDomain = safeLower(b.customDomain || tenantDoc.customDomain);
      tenantDoc.country = str(b.country || tenantDoc.country);
      tenantDoc.timezone = str(b.timezone || tenantDoc.timezone || "Africa/Kampala");
      tenantDoc.currency = str(b.currency || tenantDoc.currency || "USD").toUpperCase();
      tenantDoc.updatedBy = actorUserId(req);

      if (selectedSchoolUnit) {
        selectedSchoolUnit.name = str(b.name || selectedSchoolUnit.name);
      } else {
        tenantDoc.name = str(b.name || tenantDoc.name);
      }

      p.enabled = !!(b.enabled === "on" || b.enabled === "true" || b.enabled === true);
      p.verified = !!(b.verified === "on" || b.verified === "true" || b.verified === true);

      p.type = str(b.type);
      p.shortName = str(b.shortName);
      p.tagline = str(b.tagline);
      p.motto = str(b.motto);
      p.system = str(b.system);
      p.ownership = str(b.ownership);
      p.category = str(b.category);
      p.foundedYear = str(b.foundedYear) ? Number(str(b.foundedYear)) : p.foundedYear;

      p.about = str(b.about);
      p.mission = str(b.mission);
      p.vision = str(b.vision);

      p.values = csvToArray(b.values);
      p.facilities = csvToArray(b.facilities);
      p.accreditations = csvToArray(b.accreditations);
      p.clubs = csvToArray(b.clubs);
      p.scholarships = csvToArray(b.scholarships);
      p.policies = csvToArray(b.policies);

      const why = linesToArray(b.whyChooseUs);
      p.whyChooseUs = why;
      p.highlights = why;

      c.phone = str(b.phone);
      c.altPhone = str(b.altPhone);
      c.email = safeLower(b.email);
      c.admissionsEmail = safeLower(b.admissionsEmail);
      c.billingEmail = safeLower(b.billingEmail);
      c.website = str(b.website);
      c.addressFull = str(b.addressFull);
      c.postalAddress = str(b.postalAddress);

      s.facebook = str(b.facebook);
      s.instagram = str(b.instagram);
      s.x = str(b.x);
      s.youtube = str(b.youtube);
      s.tiktok = str(b.tiktok);
      s.linkedin = str(b.linkedin);
      s.whatsapp = str(b.whatsapp);

      l.country = str(b.locationCountry || b.country || l.country);
      l.city = str(b.city || b.locationCity || l.city);
      p.city = l.city;
      l.district = str(b.district);
      l.addressLine1 = str(b.addressLine1);
      l.addressLine2 = str(b.addressLine2);
      l.googleMapUrl = str(b.googleMapUrl);

      if (b.lat !== undefined && str(b.lat) !== "") l.lat = Number(str(b.lat));
      else delete l.lat;

      if (b.lng !== undefined && str(b.lng) !== "") l.lng = Number(str(b.lng));
      else delete l.lng;

      a.applyUrl = str(b.applyUrl);
      a.requirements = str(b.requirements);
      a.officeHours = str(b.officeHours);
      a.intakeLabel = str(b.intakeLabel);
      a.applicationFeeText = str(b.applicationFeeText);
      a.admissionPhone = str(b.admissionPhone);
      a.isOpen = !!(
        b.admissionsOpen === "on" ||
        b.admissionsOpen === "true" ||
        b.admissionsOpen === true
      );

      a.steps = linesToArray(b.admissionSteps);
      a.requiredDocs = linesToArray(b.requiredDocs);
      a.feesRange = str(b.feesRange);
      a.paymentOptions = str(b.paymentOptions);

      p.applyUrl = a.applyUrl;
      p.requirements = a.requirements;
      p.officeHours = a.officeHours;
      p.intakeLabel = a.intakeLabel;
      p.applicationFeeText = a.applicationFeeText;
      p.admissionPhone = a.admissionPhone;
      p.admissionsOpen = a.isOpen;
      p.feesRange = a.feesRange;
      p.paymentOptions = a.paymentOptions;

      seo.metaTitle = str(b.metaTitle);
      seo.metaDescription = str(b.metaDescription);
      seo.keywords = csvToArray(b.keywords);
      seo.ogImageUrl = str(b.ogImageUrl);
      seo.canonicalUrl = str(b.canonicalUrl);
      seo.indexable = !(
        b.indexable === "false" ||
        b.indexable === false ||
        b.indexable === "off"
      );
      seo.structuredDataEnabled = !(
        b.structuredDataEnabled === "false" ||
        b.structuredDataEnabled === false ||
        b.structuredDataEnabled === "off"
      );

      br.primaryColor = str(b.primaryColor || br.primaryColor || "#0a3d62");
      br.accentColor = str(b.accentColor || br.accentColor || "#0a6fbf");
      br.secondaryColor = str(b.secondaryColor || br.secondaryColor || "#083454");
      br.textColor = str(b.textColor || br.textColor || "#0f172a");
      br.buttonRadius = str(b.buttonRadius) ? Number(str(b.buttonRadius)) : br.buttonRadius;

      prefs.allowPublicProfile = !(
        b.allowPublicProfile === "false" || b.allowPublicProfile === false
      );
      prefs.allowReviews = !(
        b.allowReviews === "false" || b.allowReviews === false
      );
      prefs.showContactForm = !(
        b.showContactForm === "false" || b.showContactForm === false
      );
      prefs.showGallery = !(
        b.showGallery === "false" || b.showGallery === false
      );

      if (typeof b.awardsText === "string" || Array.isArray(b.awardsText)) {
        p.awards = parseAwards(b.awardsText);
      }

      if (typeof b.newsText === "string" || Array.isArray(b.newsText)) {
        p.announcements = parseNews(b.newsText);
      }

      p.ratingSummary = calculateRatingSummary(p.reviews);
      tenantDoc.meta.lastProfileUpdateAt = new Date();
      tenantDoc.meta.lastPublicContentUpdateAt = new Date();

      normalizeGallery(p);

      tenantDoc.markModified("settings.profile");
      tenantDoc.markModified("settings.profile.location");
      tenantDoc.markModified("settings.profile.admissions");
      tenantDoc.markModified("settings.branding");
      tenantDoc.markModified("settings.preferences");

      if (selectedSchoolUnit) {
        syncTenantSettingsBackToSchoolUnit(tenantDoc, selectedSchoolUnit);
      }

      await tenantDoc.save();
      return res.redirect(
        profileRedirectPath(selectedSchoolUnit ? String(selectedSchoolUnit._id) : "")
      );
    } catch (err) {
      console.error("profile update error:", err);
      return res.status(400).send(err.message || "Failed to save profile.");
    }
  },

  uploadLogo: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);
      const selectedSchoolUnit = getSelectedSchoolUnit(tenantDoc, req);
      if (selectedSchoolUnit) {
        seedSchoolUnitFromTenantIfEmpty(tenantDoc, selectedSchoolUnit);
        mirrorSchoolUnitToTenantSettings(tenantDoc, selectedSchoolUnit);
      }

      if (!req.file) {
        return res.status(400).json({ ok: false, message: "No file uploaded." });
      }

      const folder = `classic-academy/${tenantDoc.code}/logo`;
      const result = await uploadBuffer(req.file, folder, {
        resource_type: "image",
      });

      const oldPublicId = tenantDoc.settings.branding.logoPublicId;
      if (oldPublicId) await safeDestroy(oldPublicId, "image");

      tenantDoc.settings.branding.logoUrl = result.secure_url || result.url;
      tenantDoc.settings.branding.logoPublicId = result.public_id;
      tenantDoc.meta.lastProfileUpdateAt = new Date();

      tenantDoc.markModified("settings.branding");
      if (selectedSchoolUnit) syncTenantSettingsBackToSchoolUnit(tenantDoc, selectedSchoolUnit);
      await tenantDoc.save();

      return res.json({
        ok: true,
        url: tenantDoc.settings.branding.logoUrl,
      });
    } catch (err) {
      console.error("uploadLogo error:", err);
      return res.status(500).json({
        ok: false,
        message: friendlyUploadError(err, "Logo upload failed."),
      });
    }
  },

  uploadFavicon: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);
      const selectedSchoolUnit = getSelectedSchoolUnit(tenantDoc, req);
      if (selectedSchoolUnit) {
        seedSchoolUnitFromTenantIfEmpty(tenantDoc, selectedSchoolUnit);
        mirrorSchoolUnitToTenantSettings(tenantDoc, selectedSchoolUnit);
      }

      if (!req.file) {
        return res.status(400).json({ ok: false, message: "No file uploaded." });
      }

      const folder = `classic-academy/${tenantDoc.code}/favicon`;
      const result = await uploadBuffer(req.file, folder, {
        resource_type: "image",
      });

      const oldPublicId = tenantDoc.settings.branding.faviconPublicId;
      if (oldPublicId) await safeDestroy(oldPublicId, "image");

      tenantDoc.settings.branding.faviconUrl = result.secure_url || result.url;
      tenantDoc.settings.branding.faviconPublicId = result.public_id;
      tenantDoc.meta.lastProfileUpdateAt = new Date();

      tenantDoc.markModified("settings.branding");
      if (selectedSchoolUnit) syncTenantSettingsBackToSchoolUnit(tenantDoc, selectedSchoolUnit);
      await tenantDoc.save();

      return res.json({
        ok: true,
        url: tenantDoc.settings.branding.faviconUrl,
      });
    } catch (err) {
      console.error("uploadFavicon error:", err);
      return res.status(500).json({
        ok: false,
        message: friendlyUploadError(err, "Favicon upload failed."),
      });
    }
  },

  uploadCover: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);
      const selectedSchoolUnit = getSelectedSchoolUnit(tenantDoc, req);
      if (selectedSchoolUnit) {
        seedSchoolUnitFromTenantIfEmpty(tenantDoc, selectedSchoolUnit);
        mirrorSchoolUnitToTenantSettings(tenantDoc, selectedSchoolUnit);
      }

      if (!req.file) {
        return res.status(400).json({ ok: false, message: "No file uploaded." });
      }

      const folder = `classic-academy/${tenantDoc.code}/cover`;
      const result = await uploadBuffer(req.file, folder, {
        resource_type: "image",
      });

      const oldPublicId = tenantDoc.settings.branding.coverPublicId;
      if (oldPublicId) await safeDestroy(oldPublicId, "image");

      tenantDoc.settings.branding.coverUrl = result.secure_url || result.url;
      tenantDoc.settings.branding.coverPublicId = result.public_id;
      tenantDoc.meta.lastProfileUpdateAt = new Date();
      tenantDoc.meta.lastPublicContentUpdateAt = new Date();

      tenantDoc.markModified("settings.branding");
      if (selectedSchoolUnit) syncTenantSettingsBackToSchoolUnit(tenantDoc, selectedSchoolUnit);
      await tenantDoc.save();

      return res.json({
        ok: true,
        url: tenantDoc.settings.branding.coverUrl,
      });
    } catch (err) {
      console.error("uploadCover error:", err);
      return res.status(500).json({
        ok: false,
        message: friendlyUploadError(err, "Cover upload failed."),
      });
    }
  },

  uploadGallery: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);
      const selectedSchoolUnit = getSelectedSchoolUnit(tenantDoc, req);
      if (selectedSchoolUnit) {
        seedSchoolUnitFromTenantIfEmpty(tenantDoc, selectedSchoolUnit);
        mirrorSchoolUnitToTenantSettings(tenantDoc, selectedSchoolUnit);
      }

      let files = [];
      if (req.files && Array.isArray(req.files.gallery)) files = req.files.gallery;
      else if (req.files && Array.isArray(req.files.images)) files = req.files.images;
      else if (Array.isArray(req.files)) files = req.files;
      else if (req.file) files = [req.file];

      if (!files.length) {
        return res.status(400).json({
          ok: false,
          message: "No files received. Ensure multer uses upload.array('gallery').",
        });
      }

      const p = tenantDoc.settings.profile;
      normalizeGallery(p);

      const folder = `classic-academy/${tenantDoc.code}/gallery`;

      for (const f of files) {
        if (!f || !f.buffer) {
          return res.status(400).json({
            ok: false,
            message: "Uploaded file has no buffer. Use multer.memoryStorage().",
          });
        }

        if (!String(f.mimetype || "").startsWith("image/")) {
          return res.status(400).json({
            ok: false,
            message: "Only image files are allowed.",
          });
        }

        const result = await uploadBuffer(f, folder, {
          resource_type: "image",
        });

        p.gallery.push({
          _id: new mongoose.Types.ObjectId(),
          url: result.secure_url || result.url,
          publicId: result.public_id,
          caption: "",
          sort: p.gallery.length,
          uploadedAt: new Date(),
        });
      }

      normalizeGallery(p);
      tenantDoc.meta.lastPublicContentUpdateAt = new Date();
      tenantDoc.markModified("settings.profile.gallery");
      if (selectedSchoolUnit) syncTenantSettingsBackToSchoolUnit(tenantDoc, selectedSchoolUnit);
      await tenantDoc.save();

      return res.json({
        ok: true,
        count: files.length,
        gallery: p.gallery,
      });
    } catch (err) {
      console.error("uploadGallery error:", err);
      return res.status(500).json({
        ok: false,
        message: friendlyUploadError(err, "Gallery upload failed."),
      });
    }
  },

  deleteGalleryItem: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);
      const selectedSchoolUnit = getSelectedSchoolUnit(tenantDoc, req);
      if (selectedSchoolUnit) {
        seedSchoolUnitFromTenantIfEmpty(tenantDoc, selectedSchoolUnit);
        mirrorSchoolUnitToTenantSettings(tenantDoc, selectedSchoolUnit);
      }

      const itemId = String(req.params.itemId || "");

      if (!mongoose.isValidObjectId(itemId)) {
        return res.status(400).json({ ok: false, message: "Invalid image id." });
      }

      const p = tenantDoc.settings.profile;
      normalizeGallery(p);

      const idx = Array.isArray(p.gallery)
        ? p.gallery.findIndex((g) => String(g._id) === itemId)
        : -1;

      if (idx === -1) {
        return res.status(404).json({ ok: false, message: "Image not found." });
      }

      const [item] = p.gallery.splice(idx, 1);
      const publicId = item?.publicId || "";

      p.gallery = p.gallery.map((g, i) => ({
        ...g,
        sort: i,
      }));

      tenantDoc.meta.lastPublicContentUpdateAt = new Date();
      tenantDoc.markModified("settings.profile.gallery");
      if (selectedSchoolUnit) syncTenantSettingsBackToSchoolUnit(tenantDoc, selectedSchoolUnit);
      await tenantDoc.save();

      if (publicId) await safeDestroy(publicId, "image");

      return res.json({ ok: true });
    } catch (err) {
      console.error("deleteGalleryItem error:", err);
      return res.status(500).json({
        ok: false,
        message: err.message || "Failed to delete image.",
      });
    }
  },

  addFaq: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);
      const selectedSchoolUnit = getSelectedSchoolUnit(tenantDoc, req);
      if (selectedSchoolUnit) {
        seedSchoolUnitFromTenantIfEmpty(tenantDoc, selectedSchoolUnit);
        mirrorSchoolUnitToTenantSettings(tenantDoc, selectedSchoolUnit);
      }

      const q = str(req.body.q).slice(0, 160);
      const a = str(req.body.a).slice(0, 900);

      if (!q || !a) {
        return res.status(400).json({
          ok: false,
          message: "Question and answer are required.",
        });
      }

      tenantDoc.settings.profile.faqs.push({
        q,
        a,
        sort: tenantDoc.settings.profile.faqs.length,
      });

      tenantDoc.meta.lastPublicContentUpdateAt = new Date();
      tenantDoc.markModified("settings.profile.faqs");
      if (selectedSchoolUnit) syncTenantSettingsBackToSchoolUnit(tenantDoc, selectedSchoolUnit);
      await tenantDoc.save();

      return res.json({ ok: true });
    } catch (err) {
      console.error("addFaq error:", err);
      return res.status(500).json({
        ok: false,
        message: err.message || "Failed to add FAQ.",
      });
    }
  },

  editFaq: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);
      const selectedSchoolUnit = getSelectedSchoolUnit(tenantDoc, req);
      if (selectedSchoolUnit) {
        seedSchoolUnitFromTenantIfEmpty(tenantDoc, selectedSchoolUnit);
        mirrorSchoolUnitToTenantSettings(tenantDoc, selectedSchoolUnit);
      }

      const faqId = req.params.faqId;

      if (!mongoose.isValidObjectId(faqId)) {
        return res.status(400).json({ ok: false, message: "Invalid FAQ id." });
      }

      const q = str(req.body.q).slice(0, 160);
      const a = str(req.body.a).slice(0, 900);

      if (!q || !a) {
        return res.status(400).json({
          ok: false,
          message: "Question and answer are required.",
        });
      }

      const item = tenantDoc.settings.profile.faqs.id(faqId);
      if (!item) {
        return res.status(404).json({ ok: false, message: "FAQ not found." });
      }

      item.q = q;
      item.a = a;

      tenantDoc.meta.lastPublicContentUpdateAt = new Date();
      tenantDoc.markModified("settings.profile.faqs");
      if (selectedSchoolUnit) syncTenantSettingsBackToSchoolUnit(tenantDoc, selectedSchoolUnit);
      await tenantDoc.save();

      return res.json({ ok: true });
    } catch (err) {
      console.error("editFaq error:", err);
      return res.status(500).json({
        ok: false,
        message: err.message || "Failed to edit FAQ.",
      });
    }
  },

  deleteFaq: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);
      const selectedSchoolUnit = getSelectedSchoolUnit(tenantDoc, req);
      if (selectedSchoolUnit) {
        seedSchoolUnitFromTenantIfEmpty(tenantDoc, selectedSchoolUnit);
        mirrorSchoolUnitToTenantSettings(tenantDoc, selectedSchoolUnit);
      }

      const faqId = req.params.faqId;

      if (!mongoose.isValidObjectId(faqId)) {
        return res.status(400).json({ ok: false, message: "Invalid FAQ id." });
      }

      const item = tenantDoc.settings.profile.faqs.id(faqId);
      if (!item) {
        return res.status(404).json({ ok: false, message: "FAQ not found." });
      }

      item.deleteOne();

      tenantDoc.meta.lastPublicContentUpdateAt = new Date();
      tenantDoc.markModified("settings.profile.faqs");
      if (selectedSchoolUnit) syncTenantSettingsBackToSchoolUnit(tenantDoc, selectedSchoolUnit);
      await tenantDoc.save();

      return res.json({ ok: true });
    } catch (err) {
      console.error("deleteFaq error:", err);
      return res.status(500).json({
        ok: false,
        message: err.message || "Failed to delete FAQ.",
      });
    }
  },

  approveReview: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);
      const selectedSchoolUnit = getSelectedSchoolUnit(tenantDoc, req);
      if (selectedSchoolUnit) {
        seedSchoolUnitFromTenantIfEmpty(tenantDoc, selectedSchoolUnit);
        mirrorSchoolUnitToTenantSettings(tenantDoc, selectedSchoolUnit);
      }

      const reviewId = req.params.reviewId;

      const review = tenantDoc.settings.profile.reviews.id(reviewId);
      if (!review) {
        return res.status(404).json({ ok: false, message: "Review not found." });
      }

      review.status = "approved";
      review.approvedAt = new Date();

      tenantDoc.settings.profile.ratingSummary = calculateRatingSummary(
        tenantDoc.settings.profile.reviews
      );
      tenantDoc.meta.lastPublicContentUpdateAt = new Date();

      tenantDoc.markModified("settings.profile.reviews");
      tenantDoc.markModified("settings.profile.ratingSummary");
      if (selectedSchoolUnit) syncTenantSettingsBackToSchoolUnit(tenantDoc, selectedSchoolUnit);
      await tenantDoc.save();

      if (wantsJson(req)) return res.json({ ok: true });
      return res.redirect("/admin/profile?success=1");
    } catch (err) {
      console.error("approveReview error:", err);
      if (wantsJson(req)) {
        return res.status(500).json({
          ok: false,
          message: err.message || "Failed to approve review.",
        });
      }
      return res.status(500).send(err.message || "Failed to approve review.");
    }
  },

  rejectReview: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);
      const selectedSchoolUnit = getSelectedSchoolUnit(tenantDoc, req);
      if (selectedSchoolUnit) {
        seedSchoolUnitFromTenantIfEmpty(tenantDoc, selectedSchoolUnit);
        mirrorSchoolUnitToTenantSettings(tenantDoc, selectedSchoolUnit);
      }

      const reviewId = req.params.reviewId;

      const review = tenantDoc.settings.profile.reviews.id(reviewId);
      if (!review) {
        return res.status(404).json({ ok: false, message: "Review not found." });
      }

      review.status = "rejected";

      tenantDoc.settings.profile.ratingSummary = calculateRatingSummary(
        tenantDoc.settings.profile.reviews
      );
      tenantDoc.meta.lastPublicContentUpdateAt = new Date();

      tenantDoc.markModified("settings.profile.reviews");
      tenantDoc.markModified("settings.profile.ratingSummary");
      if (selectedSchoolUnit) syncTenantSettingsBackToSchoolUnit(tenantDoc, selectedSchoolUnit);
      await tenantDoc.save();

      if (wantsJson(req)) return res.json({ ok: true });
      return res.redirect("/admin/profile?success=1");
    } catch (err) {
      console.error("rejectReview error:", err);
      if (wantsJson(req)) {
        return res.status(500).json({
          ok: false,
          message: err.message || "Failed to reject review.",
        });
      }
      return res.status(500).send(err.message || "Failed to reject review.");
    }
  },

  toggleFeaturedReview: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);
      const selectedSchoolUnit = getSelectedSchoolUnit(tenantDoc, req);
      if (selectedSchoolUnit) {
        seedSchoolUnitFromTenantIfEmpty(tenantDoc, selectedSchoolUnit);
        mirrorSchoolUnitToTenantSettings(tenantDoc, selectedSchoolUnit);
      }

      const reviewId = req.params.reviewId;

      const review = tenantDoc.settings.profile.reviews.id(reviewId);
      if (!review) {
        return res.status(404).json({ ok: false, message: "Review not found." });
      }

      review.featured = !review.featured;
      tenantDoc.meta.lastPublicContentUpdateAt = new Date();

      tenantDoc.markModified("settings.profile.reviews");
      if (selectedSchoolUnit) syncTenantSettingsBackToSchoolUnit(tenantDoc, selectedSchoolUnit);
      await tenantDoc.save();

      if (wantsJson(req)) return res.json({ ok: true });
      return res.redirect("/admin/profile?success=1");
    } catch (err) {
      console.error("toggleFeaturedReview error:", err);
      if (wantsJson(req)) {
        return res.status(500).json({
          ok: false,
          message: err.message || "Failed to update featured review.",
        });
      }
      return res.status(500).send(err.message || "Failed to update featured review.");
    }
  },

  deleteReview: async (req, res) => {
    try {
      const tenantDoc = await getTenantFromReq(req);
      const selectedSchoolUnit = getSelectedSchoolUnit(tenantDoc, req);
      if (selectedSchoolUnit) {
        seedSchoolUnitFromTenantIfEmpty(tenantDoc, selectedSchoolUnit);
        mirrorSchoolUnitToTenantSettings(tenantDoc, selectedSchoolUnit);
      }

      const reviewId = req.params.reviewId;

      const review = tenantDoc.settings.profile.reviews.id(reviewId);
      if (!review) {
        return res.status(404).json({ ok: false, message: "Review not found." });
      }

      review.deleteOne();

      tenantDoc.settings.profile.ratingSummary = calculateRatingSummary(
        tenantDoc.settings.profile.reviews
      );
      tenantDoc.meta.lastPublicContentUpdateAt = new Date();

      tenantDoc.markModified("settings.profile.reviews");
      tenantDoc.markModified("settings.profile.ratingSummary");
      if (selectedSchoolUnit) syncTenantSettingsBackToSchoolUnit(tenantDoc, selectedSchoolUnit);
      await tenantDoc.save();

      if (wantsJson(req)) return res.json({ ok: true });
      return res.redirect("/admin/profile?success=1");
    } catch (err) {
      console.error("deleteReview error:", err);
      if (wantsJson(req)) {
        return res.status(500).json({
          ok: false,
          message: err.message || "Failed to delete review.",
        });
      }
      return res.status(500).send(err.message || "Failed to delete review.");
    }
  },

  submitPublicReview: async (req, res) => {
    try {
      const code = safeLower(req.params.code);

      const tenantDoc = await Tenant.findOne({
        code,
        isDeleted: { $ne: true },
      });

      if (!tenantDoc) {
        return res.status(404).json({ ok: false, message: "School not found." });
      }

      ensureTenantShape(tenantDoc);

      const name = str(req.body.name).slice(0, 60);
      const email = safeLower(req.body.email).slice(0, 120);
      const rating = Number(req.body.rating);
      const title = str(req.body.title).slice(0, 80);
      const message = str(req.body.message).slice(0, 1200);

      if (!name) {
        return res.status(400).json({ ok: false, message: "Name is required." });
      }

      if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({
          ok: false,
          message: "Rating must be between 1 and 5.",
        });
      }

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

      tenantDoc.meta.lastPublicContentUpdateAt = new Date();
      tenantDoc.markModified("settings.profile.reviews");
      await tenantDoc.save();

      return res.json({
        ok: true,
        message: "Thanks! Review submitted for approval.",
      });
    } catch (err) {
      console.error("submitPublicReview error:", err);
      return res.status(500).json({
        ok: false,
        message: "Failed to submit review.",
      });
    }
  },
};
