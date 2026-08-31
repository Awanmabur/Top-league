const crypto = require("crypto");
const { platformConnection, getTenantConnection } = require("../../../config/db");
const Tenant = require("../../../models/platform/Tenant")(platformConnection);
const loadTenantModels = require("../../../models/tenant/loadModels");
const { publicCanonicalContent, submitCanonicalReview, sanitizePublicBranding, sanitizePublicProfileForRender, sanitizeReview, sanitizeFaq, ratingSummary } = require("../../../services/tenant/publicPresenceService");

function safeInt(n, def = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : def;
}

function displayText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value
      .map((item) => displayText(item, ""))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "object") {
    const source = asPlain(value);
    for (const key of [
      "label",
      "name",
      "title",
      "text",
      "value",
      "schoolType",
      "category",
      "type",
      "shortName",
      "code",
    ]) {
      const candidate = source[key];
      const text = displayText(candidate, "");
      if (text) return text;
    }
    return fallback;
  }

  return String(value || fallback);
}

function clean(s, max) {
  return displayText(s, "")
    .trim()
    .slice(0, max);
}

function parseWebsiteUrl(url) {
  const v = String(url || "").trim();
  if (!v) return "";
  if (!/^https?:\/\//i.test(v)) return "";
  return v;
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || "").trim());
}

function getRequestOrigin(req) {
  const host = typeof req.get === "function" ? req.get("host") || "" : "";
  const proto = req.protocol || (req.secure ? "https" : "http");
  return { host, proto };
}

function cleanHost(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/\/+$/, "");
}

function hostnameOf(value) {
  const host = cleanHost(value);
  return host.split(":")[0].toLowerCase();
}

function getConfiguredMainHostnames(req) {
  const { host } = getRequestOrigin(req);
  const baseDomain = String(process.env.BASE_DOMAIN || "")
    .trim()
    .toLowerCase();
  return new Set(
    [
      hostnameOf(host),
      baseDomain,
      baseDomain && `www.${baseDomain}`,
      hostnameOf(process.env.PUBLIC_SITE_URL),
      hostnameOf(process.env.MAIN_SITE_URL),
      hostnameOf(process.env.PLATFORM_SITE_URL),
    ].filter(Boolean),
  );
}

function isLocalPublicRequest(req) {
  const { host } = getRequestOrigin(req);
  const hostname = hostnameOf(host);
  const baseDomain = String(process.env.BASE_DOMAIN || "")
    .trim()
    .toLowerCase();

  return (
    process.env.NODE_ENV !== "production" ||
    baseDomain === "localhost" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".localhost")
  );
}

function getMainSiteUrl(req) {
  const configured =
    process.env.PUBLIC_SITE_URL ||
    process.env.MAIN_SITE_URL ||
    process.env.PLATFORM_SITE_URL ||
    "";

  if (configured) return String(configured).replace(/\/+$/, "");

  const { host, proto } = getRequestOrigin(req);
  const [hostname, port] = String(host || "").split(":");
  const portPart = port ? `:${port}` : "";
  const baseDomain = String(process.env.BASE_DOMAIN || "classicacademy.app")
    .trim()
    .toLowerCase();

  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".localhost") ||
    baseDomain === "localhost"
  ) {
    return `${proto}://localhost${portPart}`;
  }

  return `${proto}://${baseDomain}`;
}

function getSchoolUnitQueryValue(req, schoolUnit) {
  return String(
    req.query.schoolUnitId ||
      req.query.unitId ||
      req.query.schoolUnit ||
      schoolUnit?._id ||
      "",
  ).trim();
}

function appendSchoolUnitQuery(target, schoolUnitId) {
  const value = String(schoolUnitId || "").trim();
  const url = String(target || "");

  if (!value || !url || /[?&]schoolUnitId=/.test(url)) return url;

  const hashIndex = url.indexOf("#");
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
  const join = base.includes("?") ? "&" : "?";

  return `${base}${join}schoolUnitId=${encodeURIComponent(value)}${hash}`;
}

function isProfileApplyPath(pathname) {
  return /^\/schools\/[^/]+\/apply\/?$/i.test(String(pathname || ""));
}

function isPlainApplyPath(pathname) {
  return /^\/apply\/?$/i.test(String(pathname || ""));
}

function absoluteApplyUrlToTenantPath(rawApplyUrl, req) {
  if (!isHttpUrl(rawApplyUrl)) return "";

  try {
    const parsed = new URL(String(rawApplyUrl).trim());
    const isTenantApplyPath =
      isPlainApplyPath(parsed.pathname) || isProfileApplyPath(parsed.pathname);

    if (!isTenantApplyPath) return "";

    const parsedHostname = String(parsed.hostname || "").toLowerCase();
    const mainHostnames = getConfiguredMainHostnames(req);

    if (!isLocalPublicRequest(req) && !mainHostnames.has(parsedHostname)) {
      return "";
    }

    if (isProfileApplyPath(parsed.pathname)) {
      parsed.pathname = "/apply";
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (_) {
    return "";
  }
}

function normalizeApplyUrlForTenant(rawApplyUrl) {
  const raw = String(rawApplyUrl || "").trim();
  if (!raw) return "/apply";

  if (isHttpUrl(raw)) {
    try {
      const parsed = new URL(raw);
      if (isProfileApplyPath(parsed.pathname)) {
        parsed.pathname = "/apply";
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch (_) {
      return raw;
    }

    return raw;
  }

  try {
    const parsed = new URL(raw.startsWith("/") ? raw : `/${raw}`, "http://local");
    if (isProfileApplyPath(parsed.pathname)) {
      parsed.pathname = "/apply";
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (_) {
    return raw.startsWith("/") ? raw : `/${raw}`;
  }
}

function sha256(s) {
  return crypto.createHash("sha256").update(String(s || "")).digest("hex");
}

function ipHash(ip) {
  if (!ip) return "";
  return crypto.createHash("sha256").update(String(ip)).digest("hex");
}

function useLiveTenantProfile(req) {
  return process.env.PUBLIC_PROFILE_LIVE_TENANT_DB === "1" || (process.env.NODE_ENV !== "production" && String(req.query.live || "") === "1");
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
  return faqs
    .filter((row) => row && !row.isDeleted && row.isPublished !== false)
    .slice()
    .sort((a, b) => Number(a.order ?? a.sort ?? 0) - Number(b.order ?? b.sort ?? 0))
    .slice(0, 100)
    .map(sanitizeFaq);
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
    .filter((r) => r && !r.isDeleted && String(r.status || "").trim().toLowerCase() === "approved" && Number(r.rating) >= 1 && Number(r.rating) <= 5)
    .sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || new Date(b.approvedAt || b.createdAt || 0) - new Date(a.approvedAt || a.createdAt || 0));
  const summary = ratingSummary(approvedAll);
  return { items: approvedAll.slice(0, 100).map(sanitizeReview), avg: summary.avg, count: summary.count };
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

function asPlain(value) {
  if (!value) return {};
  if (typeof value.toObject === "function") {
    return value.toObject({ depopulate: true });
  }
  return value;
}

function isMergeableObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

function mergeProfileData(base = {}, override = {}) {
  const out = { ...asPlain(base) };

  for (const [key, rawValue] of Object.entries(asPlain(override))) {
    const value = asPlain(rawValue);

    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length) out[key] = value;
      continue;
    }
    if (isMergeableObject(value)) {
      out[key] = mergeProfileData(out[key] || {}, value);
      continue;
    }
    if (typeof value === "string") {
      if (value.trim()) out[key] = value;
      continue;
    }

    out[key] = value;
  }

  return out;
}

function profileHasContent(profile = {}, branding = {}) {
  const p = asPlain(profile);
  const b = asPlain(branding);

  if (p.enabled === false) return true;

  const scalarValues = [
    p.shortName,
    p.type,
    p.tagline,
    p.about,
    p.mission,
    p.vision,
    p.contact?.phone,
    p.contact?.email,
    p.contact?.website,
    p.location?.city,
    p.location?.country,
    b.logoUrl,
    b.coverUrl,
  ];

  const arrayFields = [
    "values",
    "facilities",
    "accreditations",
    "clubs",
    "scholarships",
    "policies",
    "highlights",
    "whyChooseUs",
    "gallery",
    "awards",
    "announcements",
    "faqs",
    "reviews",
  ];

  return (
    scalarValues.some((value) => String(value || "").trim()) ||
    arrayFields.some((field) => Array.isArray(p[field]) && p[field].length)
  );
}

function getSchoolUnits(tenantDoc) {
  const units = tenantDoc.settings?.academics?.schoolUnits;
  return Array.isArray(units) ? units : [];
}

function findRequestedSchoolUnit(req, tenantDoc) {
  const units = getSchoolUnits(tenantDoc);
  const wanted = String(
    req.query.schoolUnitId ||
      req.query.unitId ||
      req.query.schoolUnit ||
      req.query.schoolUnitCode ||
      req.query.unit ||
      "",
  )
    .trim()
    .toLowerCase();

  if (wanted) {
    const found = units.find((unit) =>
      [
        unit._id,
        unit.code,
        unit.slug,
        unit.name,
      ]
        .map((value) => String(value || "").trim().toLowerCase())
        .includes(wanted),
    );

    if (found) return found;
  }

  return (
    units.find(
      (unit) =>
        unit.isActive !== false &&
        profileHasContent(unit.profile, unit.branding),
    ) ||
    units.find((unit) => unit.isActive !== false) ||
    null
  );
}

function buildPublicProfile(req, tenantDoc) {
  const schoolUnit = findRequestedSchoolUnit(req, tenantDoc);
  const unitHasProfile =
    schoolUnit && profileHasContent(schoolUnit.profile, schoolUnit.branding);
  const profile = unitHasProfile
    ? mergeProfileData(tenantDoc.settings?.profile || {}, schoolUnit.profile)
    : tenantDoc.settings?.profile || {};
  const branding = unitHasProfile
    ? mergeProfileData(tenantDoc.settings?.branding || {}, schoolUnit.branding)
    : tenantDoc.settings?.branding || {};

  return { profile, branding, schoolUnit: unitHasProfile ? schoolUnit : null };
}

async function findTenantForPublicPage(req, code) {
  return Tenant.findOne({
    code,
    isDeleted: { $ne: true },
  })
    .select("name code dbName settings status planName createdAt updatedAt")
    .lean();
}

module.exports = {
  async applyRedirect(req, res) {
    try {
      const code = String(req.params.code || "")
        .trim()
        .toLowerCase();

      const tenantDoc =
        req.tenant && String(req.tenant.code || "").toLowerCase() === code
          ? req.tenant
          : await findTenantForPublicPage(req, code);

      if (!tenantDoc) {
        return res.status(404).render("platform/public/404");
      }

      const { profile, schoolUnit } = buildPublicProfile(req, tenantDoc);
      let rawApplyUrl = normalizeApplyUrlForTenant(
        profile.admissions?.applyUrl || profile.applyUrl || "/apply",
      );
      rawApplyUrl = absoluteApplyUrlToTenantPath(rawApplyUrl, req) || rawApplyUrl;
      const schoolUnitId = getSchoolUnitQueryValue(req, schoolUnit);

      if (isHttpUrl(rawApplyUrl)) {
        return res.redirect(appendSchoolUnitQuery(rawApplyUrl, schoolUnitId));
      }

      const applyPath = String(rawApplyUrl || "/apply").startsWith("/")
        ? rawApplyUrl
        : `/${rawApplyUrl}`;

      return res.redirect(appendSchoolUnitQuery(applyPath, schoolUnitId));
    } catch (e) {
      console.error("tenant public school apply redirect:", e);
      return res.status(500).render("platform/public/500");
    }
  },

  // GET /schools/:code
  async page(req, res) {
    try {
      const code = String(req.params.code || "")
        .trim()
        .toLowerCase();

      const tenantDoc =
        req.tenant && String(req.tenant.code || "").toLowerCase() === code
          ? req.tenant
          : await findTenantForPublicPage(req, code);

      if (!tenantDoc) {
        return res.status(404).render("platform/public/404");
      }

      let { profile, branding, schoolUnit } = buildPublicProfile(req, tenantDoc);
      profile = sanitizePublicProfileForRender(profile);
      branding = sanitizePublicBranding(branding);

      if (profile.enabled === false) {
        return res.status(404).render("platform/public/404");
      }

      const tenantModels = useLiveTenantProfile(req) ? await getTenantModels(req, tenantDoc) : {};
      if (tenantModels.TenantProfile) {
        const canonicalProfile = await tenantModels.TenantProfile.findOne({ singletonKey: "school", isDeleted: { $ne: true } }).lean();
        if (canonicalProfile?.publicProfile && Object.keys(canonicalProfile.publicProfile).length) {
          profile = sanitizePublicProfileForRender({ ...profile, ...canonicalProfile.publicProfile });
          branding = sanitizePublicBranding({ ...branding, ...(canonicalProfile.branding || {}) });
        }
      }
      const counts = await computeCounts(tenantModels);
      const subjects = await loadSubjects(tenantModels, {
        ...profile,
        extraSubjects: tenantDoc.settings?.academics?.extraSubjects,
      });
      const canonicalContent = tenantModels.SchoolFAQ && tenantModels.SchoolReview
        ? await publicCanonicalContent(tenantModels)
        : null;
      const faqs = canonicalContent ? canonicalContent.faqs : loadFaqFromProfile(profile);
      const announcements = loadNewsFromProfile(profile);
      const reviews = canonicalContent
        ? { items: canonicalContent.reviews, avg: canonicalContent.summary.avg, count: canonicalContent.summary.count }
        : loadApprovedReviewsFromProfile(profile);
      const admissions = normalizeAdmissions(profile);
      const schoolUnitId = getSchoolUnitQueryValue(req, schoolUnit);
      const profileApplyHref = appendSchoolUnitQuery("/apply", schoolUnitId);

      const stats = {
        students: safeInt(profile.stats?.students, counts.students),
        subjects: safeInt(profile.stats?.subjects ?? profile.stats?.programs, counts.subjects),
        staff: safeInt(profile.stats?.staff, counts.staff),
        campuses: safeInt(
          profile.stats?.campuses,
          schoolUnit?.campuses?.length || 0,
        ),
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

      res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      return res.render("platform/public/school-profile", {
        tenant: {
          ...tenantDoc,
          mainSiteUrl: getMainSiteUrl(req),
          profileApplyHref,
          selectedSchoolUnit: schoolUnit,
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
              type: clean(profile.type || profile.category || "", 120),
              category: clean(profile.category || "", 120),
              system: clean(profile.system || "", 120),

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
      return res.status(500).render("platform/public/500");
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
        return res.status(503).json({
          ok: false,
          message: "Inquiry service is temporarily unavailable.",
        });
      }

      const saved = await SchoolInquiry.create({
        schoolCode: clean(req.tenant?.code || code, 80).toLowerCase(),
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
      const tenant = req.tenant && String(req.tenant.code || "").toLowerCase() === code
        ? req.tenant
        : await Tenant.findOne({ code, isDeleted: { $ne: true } });
      if (!tenant) return res.status(404).json({ ok: false, message: "School not found." });
      if (tenant.settings?.profile?.enabled === false || tenant.settings?.preferences?.allowReviews === false) {
        return res.status(403).json({ ok: false, message: "Reviews are not enabled for this school." });
      }
      const tenantModels = await getTenantModels(req, tenant);
      await submitCanonicalReview({ models: tenantModels, payload: req.body, ip: req.ip, userAgent: req.get("user-agent") || "" });
      return res.status(202).json({ ok: true, message: "Review submitted and is pending moderation." });
    } catch (e) {
      const duplicate = /already submitted/i.test(String(e?.message || ""));
      return res.status(duplicate ? 429 : 400).json({ ok: false, message: e?.message || "Failed to submit review." });
    }

  },
};
