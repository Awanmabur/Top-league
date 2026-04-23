const crypto = require("crypto");
const { platformConnection, getTenantConnection } = require("../../config/db");
const Tenant = require("../../models/platform/Tenant")(platformConnection);
const loadTenantModels = require("../../models/tenant/loadModels");

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
  const host = req.get("host") || "";
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
  const hosts = new Set(
    [
      hostnameOf(host),
      baseDomain,
      baseDomain && `www.${baseDomain}`,
      hostnameOf(process.env.PUBLIC_SITE_URL),
      hostnameOf(process.env.MAIN_SITE_URL),
      hostnameOf(process.env.PLATFORM_SITE_URL),
    ].filter(Boolean),
  );

  return hosts;
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

function getTenantPublicHost(req, tenantDoc) {
  const { host } = getRequestOrigin(req);
  const [hostname, port] = String(host || "").split(":");
  const cleanHostname = String(hostname || "").toLowerCase();
  const portPart = port ? `:${port}` : "";
  const baseDomain = String(process.env.BASE_DOMAIN || "").trim().toLowerCase();
  const tenantCode = tenantDoc.subdomain || tenantDoc.code || "";

  if (
    cleanHostname === "localhost" ||
    cleanHostname === "127.0.0.1" ||
    cleanHostname.endsWith(".localhost") ||
    baseDomain === "localhost"
  ) {
    return `${tenantDoc.code || tenantCode}.localhost${portPart}`;
  }

  const customDomain = cleanHost(tenantDoc.customDomain);
  const customHostname = hostnameOf(customDomain);
  const mainHostnames = getConfiguredMainHostnames(req);

  if (customDomain && !mainHostnames.has(customHostname)) {
    return customDomain;
  }

  if (tenantDoc.subdomain && String(tenantDoc.subdomain).includes(".")) {
    return cleanHost(tenantDoc.subdomain);
  }

  if (baseDomain) {
    return `${tenantCode}.${baseDomain}`;
  }

  return `${tenantDoc.code}.${cleanHostname}${portPart}`;
}

function buildTenantPublicUrl(req, tenantDoc, path = "/") {
  const { proto } = getRequestOrigin(req);
  const host = getTenantPublicHost(req, tenantDoc);
  const cleanPath = String(path || "/").startsWith("/")
    ? String(path || "/")
    : `/${path}`;

  return `${proto}://${host}${cleanPath}`;
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
  return crypto
    .createHash("sha256")
    .update(String(s || ""))
    .digest("hex");
}

function ipHash(ip) {
  if (!ip) return "";
  return crypto.createHash("sha256").update(String(ip)).digest("hex");
}

function useLiveTenantProfile(req) {
  return (
    process.env.PUBLIC_PROFILE_LIVE_TENANT_DB === "1" ||
    String(req.query.live || "") === "1"
  );
}

function escapeRegex(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

  if (Subject) {
    const rows = await Subject.find({ status: { $ne: "archived" } })
      .sort({ title: 1, code: 1 })
      .limit(80)
      .select(
        "title code shortTitle description objectives schoolUnitName campusName className classLevel category weeklyPeriods academicYear term",
      )
      .lean();

    if (rows.length) {
      return rows.map((subject) => ({
        title: subject.title || subject.code || "Subject",
        desc: subject.description || subject.objectives || "",
        level:
          [subject.classLevel, subject.className].filter(Boolean).join(" - ") ||
          subject.category ||
          "-",
        duration:
          [
            subject.academicYear,
            subject.term ? `Term ${subject.term}` : "",
            subject.weeklyPeriods
              ? `${subject.weeklyPeriods} periods/week`
              : "",
          ]
            .filter(Boolean)
            .join(" - ") || "-",
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
  }

  const rawItems = [
    ...(Array.isArray(profile.subjects) ? profile.subjects : []),
    ...(Array.isArray(profile.extraSubjects) ? profile.extraSubjects : []),
  ];

  const seen = new Set();

  return rawItems
    .map((subject) => {
      if (typeof subject === "string") {
        return {
          title: subject.trim() || "Subject",
          desc: "",
          level: "-",
          duration: "-",
          hay: String(subject || "").toLowerCase(),
        };
      }

      return {
        title: subject?.title || subject?.name || subject?.code || "Subject",
        desc:
          subject?.desc || subject?.description || subject?.objectives || "",
        level:
          subject?.level ||
          subject?.className ||
          subject?.classLevel ||
          subject?.category ||
          subject?.schoolUnitName ||
          "-",
        duration:
          [
            subject?.duration,
            subject?.academicYear,
            subject?.term ? `Term ${subject.term}` : "",
            subject?.weeklyPeriods
              ? `${subject.weeklyPeriods} periods/week`
              : "",
          ]
            .filter(Boolean)
            .join(" - ") || "-",
        hay: [
          subject?.title,
          subject?.name,
          subject?.code,
          subject?.shortTitle,
          subject?.desc,
          subject?.description,
          subject?.objectives,
          subject?.level,
          subject?.className,
          subject?.classLevel,
          subject?.category,
          subject?.schoolUnitName,
          subject?.campusName,
          subject?.academicYear,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      };
    })
    .filter((item) => {
      const key = String(item.title || "")
        .trim()
        .toLowerCase();
      if (!key) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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
    paymentOptions: clean(
      a.paymentOptions || profile.paymentOptions || "",
      200,
    ),
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

function buildSchoolListBaseFilter() {
  return {
    isDeleted: { $ne: true },
    $or: [
      { "settings.profile.enabled": { $ne: false } },
      {
        "settings.academics.schoolUnits": {
          $elemMatch: {
            isActive: { $ne: false },
            "profile.enabled": { $ne: false },
          },
        },
      },
    ],
  };
}

function addAndFilter(filter, condition) {
  filter.$and = filter.$and || [];
  filter.$and.push(condition);
}

const FEATURED_SCHOOLS_CACHE_MS =
  process.env.NODE_ENV === "production" ? 2 * 60 * 1000 : 0;
let featuredSchoolsCache = {
  expiresAt: 0,
  items: [],
};

function schoolUnitQueryFromUnit(schoolUnit) {
  return schoolUnit?._id
    ? `?schoolUnitId=${encodeURIComponent(String(schoolUnit._id))}`
    : "";
}

function buildLandingFeaturedSchoolCard(tenantDoc, schoolUnit = null) {
  const unitHasProfile =
    schoolUnit &&
    schoolUnit.profile?.enabled !== false &&
    profileHasContent(schoolUnit.profile, schoolUnit.branding);
  const profile = unitHasProfile
    ? mergeProfileData(tenantDoc.settings?.profile || {}, schoolUnit.profile)
    : tenantDoc.settings?.profile || {};
  const branding = unitHasProfile
    ? mergeProfileData(tenantDoc.settings?.branding || {}, schoolUnit.branding)
    : tenantDoc.settings?.branding || {};
  const unitQuery = schoolUnitQueryFromUnit(schoolUnit);
  const stats = profile.stats || {};
  const rating = profile.ratingSummary || {};
  const awards = Array.isArray(profile.awards) ? profile.awards : [];
  const location = profile.location || {};
  const code = encodeURIComponent(tenantDoc.code || "");

  return {
    name: clean(
      schoolUnit?.profile?.shortName ||
        schoolUnit?.name ||
        profile.shortName ||
        tenantDoc.name ||
        "School",
      120,
    ),
    type: clean(
      profile.type ||
        profile.category ||
        schoolUnit?.schoolType ||
        schoolUnit?.category ||
        "School",
      80,
    ),
    description: clean(
      profile.tagline ||
        profile.about ||
        "Explore this school's profile, subjects, admissions and public updates.",
      180,
    ),
    image:
      branding.coverUrl ||
      branding.logoUrl ||
      "https://images.unsplash.com/photo-1580582932707-520aed937b7b?q=80&w=900&auto=format&fit=crop",
    href: `/schools/${code}${unitQuery}`,
    applyHref: `/schools/${code}/apply${unitQuery}`,
    location: clean(
      [location.city, location.country].filter(Boolean).join(", "),
      120,
    ),
    students: safeInt(stats.students, 0),
    subjects: safeInt(stats.subjects ?? stats.programs, 0),
    rating: Number(rating.avg || 0),
    badge: profile.verified
      ? "Verified"
      : awards.length
        ? "Awarded"
        : Number(rating.avg || 0) >= 4.5
          ? "Top Rated"
          : "Featured",
  };
}

function buildLandingFeaturedSchools(tenantDoc) {
  const units = getSchoolUnits(tenantDoc).filter(
    (unit) => unit.isActive !== false && unit.profile?.enabled !== false,
  );

  if (units.length) {
    return units
      .map((unit) => buildLandingFeaturedSchoolCard(tenantDoc, unit))
      .filter((school) => school.name && school.href);
  }

  if (tenantDoc.settings?.profile?.enabled === false) return [];

  return [buildLandingFeaturedSchoolCard(tenantDoc)].filter(
    (school) => school.name && school.href,
  );
}

async function loadFeaturedSchoolsForLanding(limit = 8) {
  if (
    FEATURED_SCHOOLS_CACHE_MS > 0 &&
    Date.now() < featuredSchoolsCache.expiresAt
  ) {
    return featuredSchoolsCache.items;
  }

  const projection = {
    name: 1,
    code: 1,
    "settings.branding.logoUrl": 1,
    "settings.branding.coverUrl": 1,
    "settings.profile.enabled": 1,
    "settings.profile.verified": 1,
    "settings.profile.shortName": 1,
    "settings.profile.type": 1,
    "settings.profile.category": 1,
    "settings.profile.tagline": 1,
    "settings.profile.about": 1,
    "settings.profile.location": 1,
    "settings.profile.stats": 1,
    "settings.profile.ratingSummary": 1,
    "settings.profile.awards": 1,
    "settings.profile.admissions.applyUrl": 1,
    "settings.academics.schoolUnits._id": 1,
    "settings.academics.schoolUnits.name": 1,
    "settings.academics.schoolUnits.code": 1,
    "settings.academics.schoolUnits.slug": 1,
    "settings.academics.schoolUnits.schoolType": 1,
    "settings.academics.schoolUnits.category": 1,
    "settings.academics.schoolUnits.isActive": 1,
    "settings.academics.schoolUnits.profile.enabled": 1,
    "settings.academics.schoolUnits.profile.verified": 1,
    "settings.academics.schoolUnits.profile.shortName": 1,
    "settings.academics.schoolUnits.profile.type": 1,
    "settings.academics.schoolUnits.profile.category": 1,
    "settings.academics.schoolUnits.profile.tagline": 1,
    "settings.academics.schoolUnits.profile.about": 1,
    "settings.academics.schoolUnits.profile.location": 1,
    "settings.academics.schoolUnits.profile.stats": 1,
    "settings.academics.schoolUnits.profile.ratingSummary": 1,
    "settings.academics.schoolUnits.profile.awards": 1,
    "settings.academics.schoolUnits.profile.admissions.applyUrl": 1,
    "settings.academics.schoolUnits.branding.logoUrl": 1,
    "settings.academics.schoolUnits.branding.coverUrl": 1,
  };

  const queryLimit = Math.max(limit * 3, 24);
  const rows = await Tenant.find(buildSchoolListBaseFilter())
    .select(projection)
    .sort({
      "settings.profile.verified": -1,
      "settings.profile.ratingSummary.avg": -1,
      "settings.profile.stats.students": -1,
      createdAt: -1,
    })
    .limit(queryLimit)
    .lean();

  const items = rows
    .flatMap(buildLandingFeaturedSchools)
    .filter((school) => school.name && school.href)
    .slice(0, limit);

  if (FEATURED_SCHOOLS_CACHE_MS > 0) {
    featuredSchoolsCache = {
      expiresAt: Date.now() + FEATURED_SCHOOLS_CACHE_MS,
      items,
    };
  }

  return items;
}

async function findTenantForPublicPage(req, code) {
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
  if (normalized === "verified") return { "settings.profile.verified": true };
  if (normalized === "boarding")
    return { "settings.profile.system": { $regex: /boarding/i } };
  if (normalized === "day")
    return { "settings.profile.system": { $regex: /day/i } };

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
        {
          "settings.academics.extraSubjects": {
            $regex: /(ict|computer|technology)/i,
          },
        },
        {
          "settings.profile.tagline": { $regex: /(ict|computer|technology)/i },
        },
        {
          "settings.profile.highlights": {
            $regex: /(ict|computer|technology)/i,
          },
        },
        {
          "settings.profile.facilities": {
            $regex: /(ict|computer|technology)/i,
          },
        },
      ],
    };
  }

  return null;
}

module.exports = {
  async landing(req, res) {
    try {
      const featuredSchools = await loadFeaturedSchoolsForLanding();
      return res.render("platform/public/index", { featuredSchools });
    } catch (e) {
      console.error("public landing featured schools:", e);
      return res.render("platform/public/index", { featuredSchools: [] });
    }
  },

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

      if (city) filter["settings.profile.location.city"] = city;
      if (type) filter["settings.profile.type"] = type;
      if (verified) filter["settings.profile.verified"] = true;

      if (q) {
        const rx = new RegExp(escapeRegex(q), "i");
        addAndFilter(filter, {
          $or: [
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
            { "settings.academics.schoolUnits.name": rx },
            { "settings.academics.schoolUnits.code": rx },
            { "settings.academics.schoolUnits.slug": rx },
            { "settings.academics.schoolUnits.profile.shortName": rx },
            { "settings.academics.schoolUnits.profile.type": rx },
            { "settings.academics.schoolUnits.profile.tagline": rx },
          ],
        });
      }

      const chipFilter = buildChipFilter(chip);
      if (chipFilter) {
        addAndFilter(filter, chipFilter);
      }

      let sortObj = { createdAt: -1 };

      if (sort === "name") {
        sortObj = { name: 1 };
      } else if (sort === "students") {
        sortObj = { "settings.profile.stats.students": -1, name: 1 };
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
        "settings.academics.extraSubjects": 1,
        "settings.academics.schoolUnits._id": 1,
        "settings.academics.schoolUnits.isActive": 1,
        "settings.academics.schoolUnits.profile.enabled": 1,
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
      return res.status(500).render("platform/public/500");
    }
  },

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

      return res.redirect(
        appendSchoolUnitQuery(
          buildTenantPublicUrl(req, tenantDoc, applyPath),
          schoolUnitId,
        ),
      );
    } catch (e) {
      console.error("public school apply redirect:", e);
      return res.status(500).render("platform/public/500");
    }
  },

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

      const { profile, branding, schoolUnit } = buildPublicProfile(req, tenantDoc);

      if (profile.enabled === false) {
        return res.status(404).render("platform/public/404");
      }

      let tenantModels = {};
      if (useLiveTenantProfile(req)) {
        try {
          tenantModels = await getTenantModels(req, tenantDoc);
        } catch (err) {
          console.error("public school profile tenant model load failed:", err);
          tenantModels = {};
        }
      }

      const counts = await computeCounts(tenantModels);

      const subjects = await loadSubjects(tenantModels, {
        ...profile,
        extraSubjects: tenantDoc.settings?.academics?.extraSubjects,
      });

      const faqs = loadFaqFromProfile(profile);
      const announcements = loadNewsFromProfile(profile);
      const reviews = loadApprovedReviewsFromProfile(profile);
      const admissions = normalizeAdmissions(profile);
      const schoolUnitId = getSchoolUnitQueryValue(req, schoolUnit);
      let profileApplyTarget = normalizeApplyUrlForTenant(
        profile.admissions?.applyUrl || profile.applyUrl || "/apply",
      );
      profileApplyTarget =
        absoluteApplyUrlToTenantPath(profileApplyTarget, req) ||
        profileApplyTarget;
      const profileApplyHref = appendSchoolUnitQuery(
        isHttpUrl(profileApplyTarget)
          ? profileApplyTarget
          : buildTenantPublicUrl(req, tenantDoc, profileApplyTarget),
        schoolUnitId,
      );

      const stats = {
        students: safeInt(profile.stats?.students, counts.students),
        subjects: safeInt(
          profile.stats?.subjects ?? profile.stats?.programs,
          subjects.length || counts.subjects,
        ),
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
        return res.json({ ok: true, message: "Message submitted ✅" });
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
