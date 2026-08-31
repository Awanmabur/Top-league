const { platformConnection, getTenantConnection } = require("../../config/db");
const { sendMail } = require("../../utils/mailer");
const { getTenantModulesFromPlan } = require("../../utils/tenantPlanAccess");
const { createSetPasswordInvite } = require("../../utils/inviteService");
const {
  assertCampusLimit,
  assertTenantUsageLimits,
  assertCustomDomainAllowed,
  assertSubscriptionTransition,
  buildInitialSubscription,
  historyEntry,
  mapTenantStatusToSubscription,
  positiveRevision,
  snapshotPlan,
  subscriptionEffectiveStatus,
  tenantProjectionFromSubscription,
  validateManualActivationInput,
} = require("../../services/platformSubscriptionService");
const { invalidateTenantAccess } = require("../../services/platformTenantAccessCache");
const { invalidatePublicSchoolCache } = require("../../services/platformPublicCacheService");

const Tenant = require("../../models/platform/Tenant")(platformConnection);
const Plan = require("../../models/platform/Plan")(platformConnection);
const PlatformSubscription = require("../../models/platform/PlatformSubscription")(platformConnection);
const AuditLog = require("../../models/platform/AuditLog")(platformConnection);
const loadTenantModels = require("../../models/tenant/loadModels");

const SCHOOL_TYPE_OPTIONS = [
  "private",
  "government",
  "faith-based",
  "international",
  "community",
  "other",
];
const SCHOOL_CATEGORY_OPTIONS = ["nursery", "primary", "secondary", "mixed"];
const SCHOOL_LEVEL_OPTIONS = [
  "baby",
  "middle",
  "top",
  "p1",
  "p2",
  "p3",
  "p4",
  "p5",
  "p6",
  "p7",
  "s1",
  "s2",
  "s3",
  "s4",
  "s5",
  "s6",
];
const SCHOOL_SECTION_OPTIONS = [
  "general",
  "north",
  "south",
  "east",
  "west",
  "a",
  "b",
  "c",
  "arts",
  "sciences",
  "commerce",
  "humanities",
];

const emailService = {
  async sendTenantAdminInvite({ tenant, ownerName, ownerEmail, inviteUrl, planName, loginUrl }) {
    const schoolName = tenant?.name || "Your School";
    const recipientName = ownerName || "Admin";
    const subject = `Set up your ${schoolName} admin account`;
    const text = [
      `Hello ${recipientName},`,
      "",
      `Your school account for ${schoolName} has been created on Classic Academy.`,
      `Assigned plan: ${planName || "Assigned Plan"}`,
      "",
      "Set your password using this secure link:",
      inviteUrl,
      "",
      `Login URL: ${loginUrl}`,
      "This setup link expires in 24 hours.",
      "",
      "If you did not expect this email, please contact support.",
      "",
      "Classic Academy Team",
    ].join("\n");

    const html = `
      <div style="margin:0;padding:24px;background:#f5f8ff;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e4ecfb;border-radius:14px;overflow:hidden;">
          <div style="padding:20px 24px;background:#0a3d62;color:#ffffff;">
            <h2 style="margin:0;font-size:20px;line-height:1.3;">Set up your admin account</h2>
            <p style="margin:8px 0 0;font-size:13px;opacity:.9;">Classic Academy school onboarding</p>
          </div>
          <div style="padding:24px;">
            <p style="margin:0 0 14px;">Hello <strong>${recipientName}</strong>,</p>
            <p style="margin:0 0 14px;line-height:1.7;">Your school account for <strong>${schoolName}</strong> has been created on Classic Academy.</p>
            <div style="margin:0 0 16px;padding:14px;border:1px solid #dbe7ff;border-radius:12px;background:#f8fbff;">
              <div style="font-size:12px;color:#64748b;margin-bottom:6px;">Assigned Plan</div>
              <div style="font-size:14px;font-weight:700;color:#0f172a;">${planName || "Assigned Plan"}</div>
            </div>
            <div style="margin:22px 0;"><a href="${inviteUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#0a3d62;color:#ffffff;text-decoration:none;font-weight:700;">Set Password</a></div>
            <p style="margin:0 0 8px;font-size:13px;color:#475569;">Or open this link manually:</p>
            <p style="margin:0 0 16px;word-break:break-all;font-size:13px;color:#0a3d62;"><a href="${inviteUrl}" style="color:#0a3d62;">${inviteUrl}</a></p>
            <div style="margin:0 0 16px;padding:14px;border:1px solid #e5e7eb;border-radius:12px;background:#ffffff;">
              <div style="font-size:12px;color:#64748b;margin-bottom:6px;">Login URL</div>
              <div style="font-size:13px;font-weight:600;color:#0f172a;">${loginUrl}</div>
            </div>
            <p style="margin:0 0 10px;line-height:1.7;color:#475569;">This setup link expires in <strong>24 hours</strong>. If it expires, your platform administrator can resend the invitation.</p>
            <p style="margin:18px 0 0;line-height:1.7;">Regards,<br /><strong>Classic Academy Team</strong></p>
          </div>
        </div>
      </div>`;

    return sendMail({ to: ownerEmail, subject, html, text });
  },
};

function safeTrim(v) { return String(v || "").trim(); }

async function invalidateTenantCache(...tenants) {
  for (const tenant of tenants.filter(Boolean)) {
    try { await invalidateTenantAccess(tenant); }
    catch (err) { console.error("tenant access cache invalidation failed:", err?.message || err); }
  }
  await invalidatePublicSchoolCache();
}
function safeLower(v) { return String(v || "").trim().toLowerCase(); }
function slugify(v) { return safeLower(v).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function isTruthy(v) { return v === true || v === "true" || v === "on" || v === "1"; }
function ensureArray(v) { return Array.isArray(v) ? v : v == null || v === "" ? [] : [v]; }
function uniqueStrings(values = []) { return [...new Set(values.filter(Boolean))]; }
function uniqueByKey(items, keyFn) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function splitName(fullName) {
  const clean = safeTrim(fullName);
  const parts = clean.split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || "Admin", lastName: parts.slice(1).join(" ") || "User" };
}
function buildLoginUrl(tenant) { const host = tenant.customDomain || tenant.subdomain; return `https://${host}/login`; }
function buildTenantBaseUrl(tenant) { const host = tenant.customDomain || tenant.subdomain; return `https://${host}`; }

function isValidEmail(value) {
  const email = safeLower(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 180;
}

function normalizeCustomDomain(value) {
  const host = safeLower(value);
  if (!host) return "";
  if (host.includes("://") || host.includes("/") || host.includes("\\") || host.includes(":")) {
    throw new Error("Custom domain must be a hostname only, without protocol, path or port.");
  }
  if (host.length > 253 || !/^[a-z0-9.-]+$/.test(host) || host.startsWith(".") || host.endsWith(".") || host.includes("..")) {
    throw new Error("Custom domain is invalid.");
  }
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-"))) {
    throw new Error("Custom domain is invalid.");
  }
  return host;
}

function normalizeTimezone(value) {
  const timezone = safeTrim(value) || "Africa/Kampala";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch (_) {
    throw new Error("Timezone must be a valid IANA timezone.");
  }
}

function normalizeCurrency(value) {
  const currency = safeTrim(value || "USD").toUpperCase();
  if (!/^[A-Z]{3,10}$/.test(currency)) throw new Error("Currency must be a 3–10 letter code.");
  return currency;
}

function getDefaultLevelsByCategory(category) {
  switch (safeLower(category)) {
    case "nursery":
      return ["baby", "middle", "top"];
    case "primary":
      return ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
    case "secondary":
      return ["s1", "s2", "s3", "s4", "s5", "s6"];
    case "mixed":
    default:
      return ["baby", "middle", "top", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "s1", "s2", "s3", "s4", "s5", "s6"];
  }
}

function getDefaultSectionsForLevel(levelName, category) {
  const cleanLevel = safeLower(levelName);
  const cleanCategory = safeLower(category);
  if (cleanCategory === "nursery" || ["baby", "middle", "top"].includes(cleanLevel)) {
    return ["general"];
  }
  if (cleanCategory === "secondary" || /^s[1-6]$/.test(cleanLevel)) {
    return ["general"];
  }
  if (cleanCategory === "primary" || /^p[1-7]$/.test(cleanLevel)) {
    return ["a"];
  }
  return ["general"];
}

function normalizeSection(section) {
  const name = safeTrim(typeof section === "string" ? section : section?.name);
  if (!name) return null;
  return {
    name,
    code: slugify(section?.code || name),
    isActive: section?.isActive !== false,
  };
}

function normalizeLevel(level, unitCategory = "mixed") {
  const name = safeTrim(level?.name);
  if (!name) return null;

  const providedSections = uniqueByKey(
    ensureArray(level?.sections).map(normalizeSection).filter(Boolean),
    (item) => safeLower(item.name),
  );
  const sections = providedSections.length
    ? providedSections
    : getDefaultSectionsForLevel(name, unitCategory).map((sectionName) => normalizeSection({ name: sectionName }));

  return {
    name,
    code: slugify(level?.code || name),
    isActive: level?.isActive !== false,
    profile: {
      title: safeTrim(level?.profile?.title || level?.title),
      description: safeTrim(level?.profile?.description || level?.description),
      curriculum: safeTrim(level?.profile?.curriculum || level?.curriculum),
      admissionsNote: safeTrim(level?.profile?.admissionsNote),
      feesNote: safeTrim(level?.profile?.feesNote),
    },
    sections,
  };
}

function normalizeCampus(campus, campusIndex = 0, unit = {}) {
  const name = safeTrim(campus?.name);
  const unitName = safeTrim(unit?.name) || `School Unit ${campusIndex + 1}`;
  const unitCode = slugify(unit?.code || unitName);
  const unitSlug = slugify(unit?.slug || unit?.code || unitName);
  const unitCategory = safeLower(unit?.category) || "mixed";

  const existingLevels = uniqueByKey(
    ensureArray(campus?.levels).map((level) => normalizeLevel(level, unitCategory)).filter(Boolean),
    (item) => safeLower(item.name),
  );

  const levels = existingLevels.length
    ? existingLevels
    : getDefaultLevelsByCategory(unitCategory).map((levelName) => normalizeLevel({ name: levelName }, unitCategory));

  return {
    schoolUnitName: unitName,
    schoolUnitCode: unitCode,
    schoolUnitSlug: unitSlug,
    name: name || `Campus ${campusIndex + 1}`,
    code: slugify(campus?.code || name || `campus-${campusIndex + 1}`),
    city: safeTrim(campus?.city),
    district: safeTrim(campus?.district),
    country: safeTrim(campus?.country),
    address: safeTrim(campus?.address),
    contactPhone: safeTrim(campus?.contactPhone || campus?.phone),
    contactEmail: safeLower(campus?.contactEmail || campus?.email),
    profile: {
      shortName: safeTrim(campus?.profile?.shortName),
      tagline: safeTrim(campus?.profile?.tagline),
      about: safeTrim(campus?.profile?.about),
      phone: safeTrim(campus?.profile?.phone || campus?.contactPhone || campus?.phone),
      email: safeLower(campus?.profile?.email || campus?.contactEmail || campus?.email),
      admissionsEmail: safeLower(campus?.profile?.admissionsEmail),
    },
    access: {
      isolatedOperations: campus?.access?.isolatedOperations !== false,
      adminCanSwitchIntoCampus: campus?.access?.adminCanSwitchIntoCampus !== false,
      campusScopedUsersByDefault: campus?.access?.campusScopedUsersByDefault !== false,
    },
    isMain: campus?.isMain === true,
    isActive: campus?.isActive !== false,
    levels,
  };
}

function normalizeSchoolUnit(unit, unitIndex = 0) {
  const name = safeTrim(unit?.name);
  if (!name && !ensureArray(unit?.campuses).length) return null;
  const schoolType = SCHOOL_TYPE_OPTIONS.includes(safeLower(unit?.schoolType))
    ? safeLower(unit.schoolType)
    : "private";
  const category = SCHOOL_CATEGORY_OPTIONS.includes(safeLower(unit?.category))
    ? safeLower(unit.category)
    : "mixed";

  let campuses = ensureArray(unit?.campuses)
    .map((campus, campusIndex) => normalizeCampus(campus, campusIndex, { ...unit, name: name || `School Unit ${unitIndex + 1}`, category }))
    .filter(Boolean);

  if (!campuses.length) {
    campuses = [normalizeCampus({ name: "Main Campus", isMain: true }, 0, { ...unit, name: name || `School Unit ${unitIndex + 1}`, category })];
  }

  let mainSeen = false;
  campuses = campuses.map((campus, campusIndex) => {
    const next = { ...campus };
    if (!mainSeen && (next.isMain || campusIndex === 0)) {
      next.isMain = true;
      mainSeen = true;
    } else {
      next.isMain = false;
    }
    return next;
  });

  const finalName = name || `School Unit ${unitIndex + 1}`;
  const finalCode = slugify(unit?.code || finalName || `school-unit-${unitIndex + 1}`);
  const finalSlug = slugify(unit?.slug || unit?.code || finalName || `school-unit-${unitIndex + 1}`);

  campuses = campuses.map((campus) => ({
    ...campus,
    schoolUnitName: finalName,
    schoolUnitCode: finalCode,
    schoolUnitSlug: finalSlug,
  }));

  return {
    name: finalName,
    code: finalCode,
    slug: finalSlug,
    schoolType,
    category,
    isActive: unit?.isActive !== false,
    access: {
      adminCanSwitchCampuses: unit?.access?.adminCanSwitchCampuses !== false,
      campusScopedUsersByDefault: unit?.access?.campusScopedUsersByDefault !== false,
      allowCrossCampusParentView: unit?.access?.allowCrossCampusParentView !== false,
    },
    branding: {
      logoUrl: safeTrim(unit?.branding?.logoUrl),
      logoPublicId: safeTrim(unit?.branding?.logoPublicId),
      faviconUrl: safeTrim(unit?.branding?.faviconUrl),
      faviconPublicId: safeTrim(unit?.branding?.faviconPublicId),
      coverUrl: safeTrim(unit?.branding?.coverUrl),
      coverPublicId: safeTrim(unit?.branding?.coverPublicId),
      primaryColor: safeTrim(unit?.branding?.primaryColor) || undefined,
      accentColor: safeTrim(unit?.branding?.accentColor) || undefined,
      secondaryColor: safeTrim(unit?.branding?.secondaryColor) || undefined,
      textColor: safeTrim(unit?.branding?.textColor) || undefined,
      buttonRadius: Number.isFinite(Number(unit?.branding?.buttonRadius)) ? Number(unit.branding.buttonRadius) : undefined,
    },
    profile: unit?.profile && typeof unit.profile === "object" ? unit.profile : undefined,
    campuses,
  };
}

function parseSchoolUnitsJson(raw) {
  let parsed = [];
  try { parsed = raw ? JSON.parse(raw) : []; } catch (_) { parsed = []; }
  const schoolUnits = uniqueByKey(
    ensureArray(parsed).map((unit, unitIndex) => normalizeSchoolUnit(unit, unitIndex)).filter(Boolean),
    (item) => safeLower(item.code || item.name),
  );

  const campusList = [];
  const levels = new Set();
  const sections = new Set();

  schoolUnits.forEach((schoolUnit) => {
    (schoolUnit.campuses || []).forEach((campus) => {
      campusList.push(campus);
      (campus.levels || []).forEach((level) => {
        if (level.name) levels.add(level.name);
        (level.sections || []).forEach((section) => {
          if (section.name) sections.add(section.name);
        });
      });
    });
  });

  return {
    schoolUnits,
    campuses: campusList,
    summaryLevels: Array.from(levels),
    summarySections: Array.from(sections),
  };
}

function getSchoolUnitSeed(tenant = {}) {
  const academics = tenant?.settings?.academics || {};
  if (Array.isArray(academics.schoolUnits) && academics.schoolUnits.length) return academics.schoolUnits;
  if (Array.isArray(academics.campuses) && academics.campuses.length) {
    return [{
      name: tenant.name || "Main School",
      code: tenant.code || slugify(tenant.name || "main-school"),
      slug: tenant.code || slugify(tenant.name || "main-school"),
      schoolType: "private",
      category: "mixed",
      isActive: true,
      access: { adminCanSwitchCampuses: true, campusScopedUsersByDefault: true, allowCrossCampusParentView: true },
      profile: tenant.settings?.profile || {},
      branding: tenant.settings?.branding || {},
      campuses: academics.campuses,
    }];
  }
  return [];
}

function hydrateTenantForView(tenant) {
  if (!tenant) return tenant;
  const seed = getSchoolUnitSeed(tenant);
  const { schoolUnits, campuses, summaryLevels, summarySections } = parseSchoolUnitsJson(JSON.stringify(seed));
  return {
    ...tenant,
    settings: {
      ...(tenant.settings || {}),
      academics: {
        ...(tenant.settings?.academics || {}),
        schoolUnits,
        campuses,
        educationLevels: summaryLevels,
        schoolSections: summarySections,
        hasMultipleCampuses: campuses.length > 1,
      },
    },
  };
}

async function writeAudit(req, payload) {
  try {
    await AuditLog.create({
      actorId: req.user?._id || null,
      actorName: req.user?.name || "",
      actorRole: req.user?.role || "",
      action: payload.action,
      entityType: payload.entityType || "Tenant",
      entityId: payload.entityId ? String(payload.entityId) : "",
      tenantId: payload.tenantId || null,
      description: payload.description || "",
      ipAddress: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      meta: payload.meta || {},
    });
  } catch (err) {
    console.error("tenant audit log failed:", err);
  }
}

async function findTenantAdminUser(User, tenant) {
  return User.findOne({ email: safeLower(tenant.ownerEmail), deletedAt: null }).select("+passwordHash status roles email");
}

async function resendTenantAdminInvite({ tenant, req }) {
  const tenantConn = await getTenantConnection(tenant.dbName);
  const models = loadTenantModels(tenantConn);
  const User = models.User;
  const InviteToken = models.InviteToken;
  if (!User || !InviteToken) throw new Error("Tenant invite models are not available.");

  const adminUser = await findTenantAdminUser(User, tenant);
  if (!adminUser) throw new Error("Tenant admin user not found.");
  if (adminUser.status !== "invited" || adminUser.passwordHash) {
    throw new Error("The tenant admin account is already initialized; use the password-reset flow instead.");
  }

  const invite = await createSetPasswordInvite({
    req,
    InviteToken,
    userId: adminUser._id,
    createdBy: req.user?._id || null,
    baseUrl: buildTenantBaseUrl(tenant),
  });

  const plan = tenant.planId?.name ? tenant.planId : await Plan.findById(tenant.planId).lean();
  const inviteUrl = invite.inviteLink;
  const loginUrl = buildLoginUrl(tenant);

  await emailService.sendTenantAdminInvite({
    tenant,
    ownerName: tenant.ownerName,
    ownerEmail: tenant.ownerEmail,
    inviteUrl,
    planName: plan?.name || "Assigned Plan",
    loginUrl,
  });

  return { adminUser, inviteUrl, loginUrl };
}

async function loadActivePlans() {
  return Plan.find({ isActive: true, isDeleted: { $ne: true } }).sort({ sortOrder: 1, name: 1 }).lean();
}

function buildAcademicPayload(body = {}, tenantName = "") {
  const parsed = parseSchoolUnitsJson(body.schoolUnitsJson);
  if (!parsed.schoolUnits.length && body.campusesJson) {
    const legacy = parseSchoolUnitsJson(JSON.stringify([{ name: tenantName || "Main School", campuses: JSON.parse(body.campusesJson || "[]") }]));
    return {
      institutionType: "academy",
      schoolModel: "day-boarding",
      educationLevels: legacy.summaryLevels,
      schoolSections: legacy.summarySections,
      extraSubjects: [],
      schoolUnits: legacy.schoolUnits,
      campuses: legacy.campuses,
      hasMultipleCampuses: legacy.campuses.length > 1,
    };
  }
  return {
    institutionType: "academy",
    schoolModel: parsed.schoolUnits.some((unit) => unit.category === "secondary") ? "mixed" : "day-boarding",
    educationLevels: parsed.summaryLevels,
    schoolSections: parsed.summarySections,
    schoolUnits: parsed.schoolUnits,
    campuses: parsed.campuses,
    hasMultipleCampuses: parsed.campuses.length > 1,
  };
}


async function loadPlansForTenant(currentPlanId = null) {
  const filter = {
    isDeleted: { $ne: true },
    $or: [
      { isActive: true },
      ...(currentPlanId ? [{ _id: currentPlanId }] : []),
    ],
  };
  return Plan.find(filter).sort({ isActive: -1, sortOrder: 1, name: 1 }).lean();
}

async function loadCurrentSubscription(tenantId, session = null) {
  let query = PlatformSubscription.findOne({ tenantId, isDeleted: { $ne: true } });
  if (session) query = query.session(session);
  return query;
}

async function loadTenantLicensedUsage(tenant) {
  if (!tenant?.dbName) throw new Error("Tenant database is not configured; plan capacity cannot be validated.");
  const tenantConn = await getTenantConnection(tenant.dbName);
  const models = loadTenantModels(tenantConn);
  const { Student, Staff } = models || {};
  if (!Student || !Staff) throw new Error("Tenant Student/Staff models are unavailable; plan capacity cannot be validated.");
  const [students, staff] = await Promise.all([
    Student.countDocuments({ isDeleted: { $ne: true } }),
    Staff.countDocuments({ isDeleted: { $ne: true } }),
  ]);
  return { students: Number(students || 0), staff: Number(staff || 0) };
}

async function withPlatformTransaction(work) {
  const session = await platformConnection.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

function renderTenantCreate(res, { plans = [], old = {}, error = null, statusCode = 200 } = {}) {
  return res.status(statusCode).render("platform/tenants/create", {
    plans,
    old,
    error,
    schoolTypeOptions: SCHOOL_TYPE_OPTIONS,
    schoolCategoryOptions: SCHOOL_CATEGORY_OPTIONS,
    schoolLevelOptions: SCHOOL_LEVEL_OPTIONS,
    schoolSectionOptions: SCHOOL_SECTION_OPTIONS,
  });
}

function renderTenantEdit(res, { tenant = null, subscription = null, plans = [], error = null, statusCode = 200 } = {}) {
  return res.status(statusCode).render("platform/tenants/edit", {
    tenant,
    subscription,
    plans,
    error,
    schoolTypeOptions: SCHOOL_TYPE_OPTIONS,
    schoolCategoryOptions: SCHOOL_CATEGORY_OPTIONS,
    schoolLevelOptions: SCHOOL_LEVEL_OPTIONS,
    schoolSectionOptions: SCHOOL_SECTION_OPTIONS,
  });
}

function subscriptionForTenantView(tenant, subscription) {
  if (!tenant) return tenant;
  const hydrated = hydrateTenantForView(tenant);
  return {
    ...hydrated,
    subscription: subscription || null,
    effectiveSubscriptionStatus: subscription ? subscriptionEffectiveStatus(subscription) : hydrated.status,
  };
}

module.exports = {
  listTenants: async (req, res) => {
    try {
      const { q = "", status = "", plan = "" } = req.query;
      const filter = { isDeleted: { $ne: true } };
      if (status) filter.status = safeLower(status);
      if (plan) filter.planId = plan;
      if (safeTrim(q)) filter.$text = { $search: safeTrim(q) };

      const [tenantsRaw, plans] = await Promise.all([
        Tenant.find(filter).populate("planId").sort(q ? { score: { $meta: "textScore" } } : { createdAt: -1 }).lean(),
        loadActivePlans(),
      ]);
      const tenantIds = tenantsRaw.map((row) => row._id);
      const subscriptions = tenantIds.length
        ? await PlatformSubscription.find({ tenantId: { $in: tenantIds }, isDeleted: { $ne: true } }).lean()
        : [];
      const subscriptionMap = new Map(subscriptions.map((row) => [String(row.tenantId), row]));
      const tenants = tenantsRaw.map((row) => subscriptionForTenantView(row, subscriptionMap.get(String(row._id)) || null));

      return res.render("platform/tenants/index", { tenants, plans, filters: { q, status, plan }, error: null });
    } catch (err) {
      console.error("listTenants error:", err);
      return res.status(500).render("platform/tenants/index", {
        tenants: [], plans: [], filters: { q: "", status: "", plan: "" }, error: "Failed to load schools."
      });
    }
  },

  createTenantForm: async (req, res) => {
    try {
      return renderTenantCreate(res, { plans: await loadActivePlans(), old: req.body || {} });
    } catch (err) {
      console.error("createTenantForm error:", err);
      return renderTenantCreate(res, { old: req.body || {}, error: "Failed to load create school form.", statusCode: 500 });
    }
  },

  createTenant: async (req, res) => {
    let createdTenant = null;
    let createdSubscription = null;
    let createdAdminUserId = null;
    let tenantModels = null;

    try {
      const {
        code, name, ownerName, ownerEmail, ownerPhone, country, timezone,
        currency, planId, status, customDomain, trialEndsAt, activationReason,
      } = req.body;
      const cleanName = safeTrim(name);
      const cleanCode = slugify(code);
      const cleanOwnerName = safeTrim(ownerName);
      const cleanOwnerEmail = safeLower(ownerEmail);
      const cleanOwnerPhone = safeTrim(ownerPhone);
      const cleanCountry = safeTrim(country);
      const cleanTimezone = normalizeTimezone(timezone);
      const cleanCurrency = normalizeCurrency(currency || "USD");
      const cleanStatus = safeLower(status || "trial");
      const cleanCustomDomain = normalizeCustomDomain(customDomain);

      if (!cleanName || !cleanCode || !cleanOwnerName || !cleanOwnerEmail || !planId) {
        return renderTenantCreate(res, {
          plans: await loadActivePlans(), old: req.body,
          error: "Name, code, owner name, owner email and plan are required.", statusCode: 400,
        });
      }
      if (cleanCode.length > 80) throw new Error("Tenant code is too long.");
      if (!isValidEmail(cleanOwnerEmail)) throw new Error("Owner email is invalid.");
      if (!["trial", "active"].includes(cleanStatus)) throw new Error("New tenants may start only as Trial or Active.");
      const cleanActivationReason = safeTrim(activationReason);
      if (cleanStatus === "active") {
        if (!req.platformAccess?.can?.("billing.manage")) {
          throw new Error("Starting a school as Active requires billing management permission.");
        }
        if (cleanActivationReason.length < 5) {
          throw new Error("A billing activation reason of at least 5 characters is required for an Active start.");
        }
      }

      const duplicate = await Tenant.findOne({
        $or: [
          { code: cleanCode },
          { subdomain: cleanCode },
          { ownerEmail: cleanOwnerEmail },
          { dbName: `uni_${cleanCode}` },
          ...(cleanCustomDomain ? [{ customDomain: cleanCustomDomain }] : []),
        ],
        isDeleted: { $ne: true },
      }).lean();
      if (duplicate) throw new Error("Tenant code, owner email, db name, or custom domain already exists.");

      const plan = await Plan.findOne({ _id: planId, isActive: true, isDeleted: { $ne: true } }).lean();
      if (!plan) throw new Error("Selected plan is invalid or inactive.");
      const planSnapshot = snapshotPlan(plan);
      const academicPayload = buildAcademicPayload(req.body, cleanName);
      assertCampusLimit(planSnapshot, academicPayload.campuses.length);
      assertCustomDomainAllowed(planSnapshot, cleanCustomDomain);

      const baseDomain = safeLower(process.env.BASE_DOMAIN || "");
      const subdomain = baseDomain ? `${cleanCode}.${baseDomain}` : cleanCode;
      const dbName = `uni_${cleanCode}`;

      const platformCreated = await withPlatformTransaction(async (session) => {
        const [tenant] = await Tenant.create([{
          name: cleanName,
          code: cleanCode,
          subdomain,
          dbName,
          customDomain: cleanCustomDomain || undefined,
          planId: plan._id,
          planName: plan.name || "",
          status: cleanStatus,
          statusReason: cleanStatus === "active" ? cleanActivationReason : "",
          ownerName: cleanOwnerName,
          ownerEmail: cleanOwnerEmail,
          ownerPhone: cleanOwnerPhone || undefined,
          country: cleanCountry || undefined,
          timezone: cleanTimezone,
          currency: cleanCurrency,
          trialEndsAt: trialEndsAt || undefined,
          revision: 1,
          subscriptionRevision: 1,
          settings: {
            branding: { primaryColor: "#0a3d62", accentColor: "#0a6fbf" },
            profile: { enabled: true, verified: false },
            academics: academicPayload,
            modules: getTenantModulesFromPlan(planSnapshot),
          },
          meta: {
            onboardingCompleted: false,
            provisioningVersion: 4,
            provisioningStatus: "pending",
            invitePending: true,
          },
          createdBy: req.user?._id || null,
          updatedBy: req.user?._id || null,
        }], { session });

        const initial = buildInitialSubscription({
          tenantId: tenant._id,
          plan,
          requestedStatus: cleanStatus,
          trialEndsAt: trialEndsAt || null,
          statusReason: cleanStatus === "active" ? cleanActivationReason : "",
          actorId: req.user?._id || null,
        });
        const [subscription] = await PlatformSubscription.create([initial], { session });
        const projection = tenantProjectionFromSubscription(subscription);
        const link = await Tenant.updateOne(
          { _id: tenant._id, revision: 1, isDeleted: { $ne: true } },
          { $set: projection },
          { session },
        );
        if (link.modifiedCount !== 1) throw new Error("Tenant subscription projection could not be linked during provisioning.");
        return { tenant, subscription };
      });

      createdTenant = platformCreated.tenant;
      createdSubscription = platformCreated.subscription;
      createdTenant.subscriptionId = createdSubscription._id;
      createdTenant.subscriptionRevision = createdSubscription.revision;
      createdTenant.trialEndsAt = createdSubscription.trialEndsAt;
      createdTenant.subscriptionStartsAt = createdSubscription.currentPeriodStart;
      createdTenant.subscriptionEndsAt = createdSubscription.currentPeriodEnd;

      const tenantConn = await getTenantConnection(dbName);
      tenantModels = loadTenantModels(tenantConn);
      const User = tenantModels.User;
      const InviteToken = tenantModels.InviteToken;
      if (!User || !InviteToken) throw new Error("Tenant user/invite models are not available.");

      const { firstName, lastName } = splitName(cleanOwnerName);
      const adminUser = await User.create({
        firstName,
        lastName,
        email: cleanOwnerEmail,
        roles: ["admin"],
        status: "invited",
        passwordHash: null,
        tokenVersion: 0,
      });
      createdAdminUserId = adminUser._id;

      const invite = await createSetPasswordInvite({
        req,
        InviteToken,
        userId: adminUser._id,
        createdBy: req.user?._id || null,
        baseUrl: buildTenantBaseUrl(createdTenant),
      });

      const loginUrl = buildLoginUrl(createdTenant);
      await emailService.sendTenantAdminInvite({
        tenant: createdTenant,
        ownerName: cleanOwnerName,
        ownerEmail: cleanOwnerEmail,
        inviteUrl: invite.inviteLink,
        planName: plan.name,
        loginUrl,
      });

      const provisioned = await Tenant.updateOne(
        { _id: createdTenant._id, isDeleted: { $ne: true } },
        {
          $set: {
            "meta.provisioningStatus": "ready",
            "meta.invitePending": true,
            "meta.inviteSentAt": new Date(),
          },
          $inc: { revision: 1 },
        },
      );
      if (provisioned.modifiedCount !== 1) throw new Error("Tenant provisioning state could not be finalized.");

      const finalTenant = await Tenant.findById(createdTenant._id).populate("planId").lean();
      await writeAudit(req, {
        action: "Create Tenant",
        entityId: createdTenant._id,
        tenantId: createdTenant._id,
        description: `Created tenant ${createdTenant.name} (${createdTenant.code}) with canonical subscription and sent admin invite`,
        meta: {
          tenantCode: createdTenant.code,
          ownerEmail: createdTenant.ownerEmail,
          planId: String(createdTenant.planId || ""),
          subscriptionId: String(createdSubscription._id || ""),
          subscriptionStatus: createdSubscription.status,
          modules: getTenantModulesFromPlan(planSnapshot),
          schoolUnits: academicPayload.schoolUnits.length,
          campuses: academicPayload.campuses.length,
        },
      });

      return res.render("platform/tenants/success", {
        tenant: subscriptionForTenantView(finalTenant, createdSubscription.toObject ? createdSubscription.toObject() : createdSubscription),
        inviteSent: true,
        invitedEmail: cleanOwnerEmail,
        loginUrl,
        error: null,
      });
    } catch (err) {
      console.error("createTenant error:", err);

      // Provisioning crosses the platform DB, tenant DB and email provider. If
      // a downstream step fails after the platform transaction committed,
      // fail closed *before* attempting destructive compensation. That way a
      // cleanup failure can never leave an Active/Trial tenant accessible.
      if (createdSubscription?._id || createdTenant?._id) {
        const reason = `Provisioning failed: ${safeTrim(err?.message || "downstream provisioning error")}`.slice(0, 500);
        try {
          await withPlatformTransaction(async (session) => {
            let nextSubscriptionRevision = null;
            if (createdSubscription?._id) {
              const currentSub = await PlatformSubscription.findById(createdSubscription._id).session(session);
              if (currentSub && currentSub.isDeleted !== true) {
                nextSubscriptionRevision = Number(currentSub.revision || 1) + 1;
                await PlatformSubscription.updateOne(
                  { _id: currentSub._id, revision: Number(currentSub.revision || 1), isDeleted: { $ne: true } },
                  {
                    $set: { status: "suspended", statusReason: reason, suspendedAt: new Date(), updatedBy: req.user?._id || null },
                    $inc: { revision: 1 },
                    $push: { history: historyEntry({ action: "provisioning_failed", fromStatus: currentSub.status, toStatus: "suspended", reason, actorId: req.user?._id || null, planId: currentSub.planId, revision: nextSubscriptionRevision }) },
                  },
                  { session },
                );
              }
            }
            if (createdTenant?._id) {
              const tenantSet = {
                status: "suspended",
                statusReason: reason,
                suspendedAt: new Date(),
                "settings.profile.enabled": false,
                "meta.provisioningStatus": "failed",
                "meta.invitePending": false,
                updatedBy: req.user?._id || null,
              };
              if (nextSubscriptionRevision) tenantSet.subscriptionRevision = nextSubscriptionRevision;
              await Tenant.updateOne(
                { _id: createdTenant._id, isDeleted: { $ne: true } },
                { $set: tenantSet, $inc: { revision: 1 } },
                { session },
              );
            }
          });
        } catch (compensationErr) {
          console.error("createTenant fail-closed compensation error:", compensationErr);
          // Best-effort fallback still prioritizes denying tenant access.
          if (createdSubscription?._id) {
            try { await PlatformSubscription.updateOne({ _id: createdSubscription._id }, { $set: { status: "suspended", statusReason: reason, suspendedAt: new Date() } }); } catch (_) {}
          }
          if (createdTenant?._id) {
            try { await Tenant.updateOne({ _id: createdTenant._id }, { $set: { status: "suspended", statusReason: reason, "settings.profile.enabled": false, "meta.provisioningStatus": "failed" } }); } catch (_) {}
          }
        }
      }

      if (tenantModels && createdAdminUserId) {
        try { await tenantModels.InviteToken?.deleteMany({ userId: createdAdminUserId }); } catch (_) {}
        try { await tenantModels.User?.deleteOne({ _id: createdAdminUserId }); } catch (_) {}
      }
      // If cleanup succeeds, creation can be retried with the same identifiers.
      // If it fails, the records remain suspended/disabled from the fail-closed
      // compensation above and therefore cannot grant tenant access.
      if (createdSubscription?._id) {
        try { await PlatformSubscription.deleteOne({ _id: createdSubscription._id }); } catch (_) {}
      }
      if (createdTenant?._id) {
        try { await Tenant.deleteOne({ _id: createdTenant._id }); } catch (_) {}
      }
      return renderTenantCreate(res, {
        plans: await loadActivePlans(), old: req.body,
        error: err?.message || "Failed to create school and send admin invite.", statusCode: 500,
      });
    }
  },

  showTenant: async (req, res) => {
    try {
      const tenantRaw = await Tenant.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).populate("planId").lean();
      if (!tenantRaw) {
        return res.status(404).render("platform/tenants/show", { tenant: null, subscription: null, error: "School not found.", inviteResent: false });
      }
      const subscription = await PlatformSubscription.findOne({ tenantId: tenantRaw._id, isDeleted: { $ne: true } }).lean();
      return res.render("platform/tenants/show", {
        tenant: subscriptionForTenantView(tenantRaw, subscription),
        subscription,
        error: null,
        inviteResent: req.query.inviteResent === "1",
      });
    } catch (err) {
      console.error("showTenant error:", err);
      return res.status(500).render("platform/tenants/show", { tenant: null, subscription: null, error: "Failed to load school details.", inviteResent: false });
    }
  },

  editTenantForm: async (req, res) => {
    try {
      const tenantRaw = await Tenant.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
      if (!tenantRaw) {
        return renderTenantEdit(res, { plans: await loadActivePlans(), error: "School not found.", statusCode: 404 });
      }
      const [subscription, plans] = await Promise.all([
        PlatformSubscription.findOne({ tenantId: tenantRaw._id, isDeleted: { $ne: true } }).lean(),
        loadPlansForTenant(tenantRaw.planId),
      ]);
      if (!subscription) return renderTenantEdit(res, { tenant: hydrateTenantForView(tenantRaw), plans, error: "School subscription is not provisioned.", statusCode: 409 });
      return renderTenantEdit(res, { tenant: subscriptionForTenantView(tenantRaw, subscription), subscription, plans });
    } catch (err) {
      console.error("editTenantForm error:", err);
      return renderTenantEdit(res, { error: "Failed to load edit school form.", statusCode: 500 });
    }
  },

  updateTenant: async (req, res) => {
    let tenantAdminRollback = null;
    try {
      const expectedTenantRevision = positiveRevision(req.body.revision);
      const expectedSubscriptionRevision = positiveRevision(req.body.subscriptionRevision);
      const tenantBefore = await Tenant.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
      if (!tenantBefore) return res.status(404).send("School not found.");
      const subscriptionBefore = await PlatformSubscription.findOne({ tenantId: tenantBefore._id, isDeleted: { $ne: true } }).lean();
      if (!subscriptionBefore) return res.status(409).send("School subscription is not provisioned.");
      if (Number(tenantBefore.revision || 1) !== expectedTenantRevision || Number(subscriptionBefore.revision || 1) !== expectedSubscriptionRevision) {
        return res.status(409).send("This school was changed by another action. Reload and try again.");
      }
      if (subscriptionBefore.status === "cancelled") return res.status(409).send("Cancelled subscriptions cannot be edited. Create a new subscription lifecycle instead.");

      const { name, ownerName, ownerEmail, ownerPhone, country, timezone, currency, planId, customDomain, profileEnabled, profileVerified } = req.body;
      const cleanName = safeTrim(name);
      const cleanOwnerName = safeTrim(ownerName);
      const cleanOwnerEmail = safeLower(ownerEmail);
      const cleanCustomDomain = normalizeCustomDomain(customDomain);
      if (!cleanName || !cleanOwnerName || !cleanOwnerEmail || !planId) throw new Error("Name, owner name, owner email and plan are required.");
      if (!isValidEmail(cleanOwnerEmail)) throw new Error("Owner email is invalid.");

      const duplicate = await Tenant.findOne({
        _id: { $ne: tenantBefore._id },
        $or: [{ ownerEmail: cleanOwnerEmail }, ...(cleanCustomDomain ? [{ customDomain: cleanCustomDomain }] : [])],
        isDeleted: { $ne: true },
      }).lean();
      if (duplicate) throw new Error("Owner email or custom domain is already used by another school.");

      const plan = await Plan.findOne({ _id: planId, isDeleted: { $ne: true } }).lean();
      if (!plan) throw new Error("Selected plan is invalid or deleted.");
      const planChanged = String(subscriptionBefore.planId || "") !== String(plan._id);
      if (planChanged && !req.platformAccess?.can?.("billing.manage")) {
        throw new Error("Changing a school subscription plan requires billing management permission.");
      }
      if (planChanged && plan.isActive !== true) throw new Error("Inactive plans cannot be newly assigned to a school.");
      // Existing subscriptions are governed by their frozen snapshot. Editing
      // the Plan catalog must not silently change limits/features for a tenant
      // until Super Admin explicitly reassigns that subscription.
      const planSnapshot = planChanged
        ? snapshotPlan(plan)
        : (subscriptionBefore.planSnapshot || snapshotPlan(plan));
      const academicPayload = buildAcademicPayload(req.body, cleanName);
      assertCampusLimit(planSnapshot, academicPayload.campuses.length);
      assertCustomDomainAllowed(planSnapshot, cleanCustomDomain);
      if (planChanged) {
        const usage = await loadTenantLicensedUsage(tenantBefore);
        assertTenantUsageLimits(planSnapshot, { ...usage, campuses: academicPayload.campuses.length });
      }

      const ownerIdentityChanged = safeLower(tenantBefore.ownerEmail) !== cleanOwnerEmail || safeTrim(tenantBefore.ownerName) !== cleanOwnerName;
      if (ownerIdentityChanged && req.user?.role !== "SuperAdmin") {
        throw new Error("Changing the tenant owner identity requires Super Admin permission.");
      }
      if (ownerIdentityChanged) {
        const tenantConn = await getTenantConnection(tenantBefore.dbName);
        const models = loadTenantModels(tenantConn);
        const User = models.User;
        if (!User) throw new Error("Tenant user model is unavailable.");
        const adminUser = await User.findOne({ email: safeLower(tenantBefore.ownerEmail), deletedAt: null }).select("_id firstName lastName email roles status").lean();
        if (!adminUser || !Array.isArray(adminUser.roles) || !adminUser.roles.includes("admin")) throw new Error("Canonical tenant admin account was not found.");
        const conflict = await User.findOne({ _id: { $ne: adminUser._id }, email: cleanOwnerEmail, deletedAt: null }).lean();
        if (conflict) throw new Error("Owner email already belongs to another tenant user.");
        const names = splitName(cleanOwnerName);
        const changed = await User.updateOne(
          { _id: adminUser._id, email: adminUser.email, deletedAt: null },
          { $set: { email: cleanOwnerEmail, firstName: names.firstName, lastName: names.lastName }, $inc: { tokenVersion: 1 } },
        );
        if (changed.modifiedCount !== 1) throw new Error("Tenant admin identity changed concurrently.");
        tenantAdminRollback = { User, adminUser };
      }

      const nextProfileVerified = req.user?.role === "SuperAdmin"
        ? isTruthy(profileVerified)
        : Boolean(tenantBefore.settings?.profile?.verified);

      const result = await withPlatformTransaction(async (session) => {
        const currentTenant = await Tenant.findOne({
          _id: tenantBefore._id,
          isDeleted: { $ne: true },
          revision: expectedTenantRevision,
        }).session(session);
        if (!currentTenant) throw new Error("Tenant revision conflict.");
        const currentSubscription = await PlatformSubscription.findOne({
          _id: subscriptionBefore._id,
          tenantId: tenantBefore._id,
          isDeleted: { $ne: true },
          revision: expectedSubscriptionRevision,
        }).session(session);
        if (!currentSubscription) throw new Error("Subscription revision conflict.");

        let nextSubscriptionRevision = expectedSubscriptionRevision;
        if (planChanged) {
          const nextRevision = expectedSubscriptionRevision + 1;
          const subUpdate = await PlatformSubscription.updateOne(
            { _id: currentSubscription._id, revision: expectedSubscriptionRevision, isDeleted: { $ne: true } },
            {
              $set: { planId: plan._id, planSnapshot, updatedBy: req.user?._id || null },
              $inc: { revision: 1 },
              $push: { history: historyEntry({ action: "plan_changed", fromStatus: currentSubscription.status, toStatus: currentSubscription.status, actorId: req.user?._id || null, planId: plan._id, revision: nextRevision }) },
            },
            { session },
          );
          if (subUpdate.modifiedCount !== 1) throw new Error("Subscription revision conflict.");
          nextSubscriptionRevision = nextRevision;
        }

        const tenantUpdate = await Tenant.updateOne(
          { _id: currentTenant._id, revision: expectedTenantRevision, isDeleted: { $ne: true } },
          {
            $set: {
              name: cleanName,
              ownerName: cleanOwnerName,
              ownerEmail: cleanOwnerEmail,
              ownerPhone: safeTrim(ownerPhone) || null,
              country: safeTrim(country) || null,
              timezone: normalizeTimezone(timezone),
              currency: normalizeCurrency(currency || currentTenant.currency || "USD"),
              customDomain: cleanCustomDomain || null,
              planId: plan._id,
              planName: planSnapshot.name || plan.name || "",
              subscriptionRevision: nextSubscriptionRevision,
              "settings.profile.enabled": isTruthy(profileEnabled),
              "settings.profile.verified": nextProfileVerified,
              "settings.academics": academicPayload,
              "settings.modules": getTenantModulesFromPlan(planSnapshot),
              updatedBy: req.user?._id || null,
            },
            $inc: { revision: 1 },
          },
          { session },
        );
        if (tenantUpdate.modifiedCount !== 1) throw new Error("Tenant revision conflict.");
        return { nextSubscriptionRevision };
      });

      const tenantAfter = await Tenant.findOne({ _id: tenantBefore._id, isDeleted: { $ne: true } }).lean().catch(() => null);
      await invalidateTenantCache(tenantBefore, tenantAfter);

      await writeAudit(req, {
        action: "Update Tenant",
        entityId: tenantBefore._id,
        tenantId: tenantBefore._id,
        description: `Updated tenant ${cleanName}`,
        meta: {
          planId: String(plan._id),
          planChanged,
          subscriptionRevision: result.nextSubscriptionRevision,
          schoolUnits: academicPayload.schoolUnits.length,
          campuses: academicPayload.campuses.length,
          ownerIdentityChanged,
        },
      });
      return res.redirect(`/super-admin/schools/${tenantBefore._id}`);
    } catch (err) {
      console.error("updateTenant error:", err);
      if (tenantAdminRollback) {
        try {
          const { User, adminUser } = tenantAdminRollback;
          await User.updateOne(
            { _id: adminUser._id, deletedAt: null },
            { $set: { email: adminUser.email, firstName: adminUser.firstName, lastName: adminUser.lastName }, $inc: { tokenVersion: 1 } },
          );
        } catch (_) {}
      }
      const tenantRaw = await Tenant.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean().catch(() => null);
      const subscription = tenantRaw ? await PlatformSubscription.findOne({ tenantId: tenantRaw._id, isDeleted: { $ne: true } }).lean().catch(() => null) : null;
      const plans = await loadPlansForTenant(tenantRaw?.planId).catch(() => []);
      return renderTenantEdit(res, {
        tenant: tenantRaw ? subscriptionForTenantView({ ...tenantRaw, ...req.body, _id: tenantRaw._id }, subscription) : null,
        subscription,
        plans,
        error: err?.message || "Failed to update school.",
        statusCode: /revision conflict|changed by another/i.test(String(err?.message || "")) ? 409 : 400,
      });
    }
  },

  updateTenantStatus: async (req, res) => {
    try {
      const expectedTenantRevision = positiveRevision(req.body.revision);
      const expectedSubscriptionRevision = positiveRevision(req.body.subscriptionRevision);
      const nextTenantStatus = safeLower(req.body.status);
      const reason = safeTrim(req.body.reason);
      if (!["trial", "active", "suspended", "cancelled"].includes(nextTenantStatus)) return res.status(400).send("Invalid tenant status.");
      if (["active", "cancelled"].includes(nextTenantStatus) && !req.platformAccess?.can?.("billing.manage")) {
        return res.status(403).send("Billing management permission is required for reactivation or cancellation.");
      }
      if (["suspended", "cancelled"].includes(nextTenantStatus) && reason.length < 5) return res.status(400).send("A reason of at least 5 characters is required.");

      let tenantInvalidation = null;
      await withPlatformTransaction(async (session) => {
        const tenant = await Tenant.findOne({ _id: req.params.id, isDeleted: { $ne: true }, revision: expectedTenantRevision }).session(session);
        if (!tenant) throw new Error("Tenant revision conflict.");
        tenantInvalidation = tenant.toObject ? tenant.toObject() : tenant;
        const subscription = await PlatformSubscription.findOne({ tenantId: tenant._id, isDeleted: { $ne: true }, revision: expectedSubscriptionRevision }).session(session);
        if (!subscription) throw new Error("Subscription revision conflict.");

        const currentEffective = subscriptionEffectiveStatus(subscription);
        const nextSubscriptionStatus = mapTenantStatusToSubscription(nextTenantStatus);
        assertSubscriptionTransition(currentEffective, nextSubscriptionStatus);

        if (nextSubscriptionStatus === "active") {
          const periodEnd = subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null;
          if (!periodEnd || Number.isNaN(periodEnd.getTime()) || periodEnd <= new Date()) {
            throw new Error("Record a completed subscription payment before reactivating this school.");
          }
        }
        if (nextSubscriptionStatus === "trial" && currentEffective !== "trial") {
          throw new Error("Trial status cannot be restarted through the lifecycle action.");
        }

        const nextRevision = expectedSubscriptionRevision + 1;
        const subSet = {
          status: nextSubscriptionStatus,
          statusReason: reason,
          updatedBy: req.user?._id || null,
        };
        if (nextSubscriptionStatus === "suspended") subSet.suspendedAt = new Date();
        if (nextSubscriptionStatus === "cancelled") subSet.cancelledAt = new Date();
        if (nextSubscriptionStatus === "active") {
          subSet.suspendedAt = null;
          subSet.statusReason = "";
        }
        const subUpdate = await PlatformSubscription.updateOne(
          { _id: subscription._id, revision: expectedSubscriptionRevision, isDeleted: { $ne: true } },
          {
            $set: subSet,
            $inc: { revision: 1 },
            $push: { history: historyEntry({ action: "status_changed", fromStatus: currentEffective, toStatus: nextSubscriptionStatus, reason, actorId: req.user?._id || null, planId: subscription.planId, revision: nextRevision }) },
          },
          { session },
        );
        if (subUpdate.modifiedCount !== 1) throw new Error("Subscription revision conflict.");

        const tenantSet = {
          status: nextTenantStatus,
          statusReason: reason,
          subscriptionRevision: nextRevision,
          updatedBy: req.user?._id || null,
        };
        if (nextTenantStatus === "suspended") tenantSet.suspendedAt = new Date();
        if (nextTenantStatus === "cancelled") tenantSet.cancelledAt = new Date();
        if (nextTenantStatus === "active") {
          tenantSet.suspendedAt = null;
          tenantSet.statusReason = "";
        }
        const tenantUpdate = await Tenant.updateOne(
          { _id: tenant._id, revision: expectedTenantRevision, isDeleted: { $ne: true } },
          { $set: tenantSet, $inc: { revision: 1 } },
          { session },
        );
        if (tenantUpdate.modifiedCount !== 1) throw new Error("Tenant revision conflict.");
      });

      const tenantAfterStatus = await Tenant.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean().catch(() => null);
      await invalidateTenantCache(tenantInvalidation, tenantAfterStatus);

      await writeAudit(req, {
        action: "Update Tenant Status",
        entityId: req.params.id,
        tenantId: req.params.id,
        description: `Changed tenant status to ${nextTenantStatus}`,
        meta: { status: nextTenantStatus, reason },
      });
      return res.redirect(`/super-admin/schools/${req.params.id}`);
    } catch (err) {
      console.error("updateTenantStatus error:", err);
      const code = /revision conflict/i.test(String(err?.message || "")) ? 409 : 400;
      return res.status(code).send(err?.message || "Failed to update tenant status.");
    }
  },

  manualActivateTenant: async (req, res) => {
    try {
      const expectedTenantRevision = positiveRevision(req.body.revision);
      const expectedSubscriptionRevision = positiveRevision(req.body.subscriptionRevision);
      const activation = validateManualActivationInput({
        reason: req.body.reason,
        periodEnd: req.body.periodEnd,
      });
      const { reason, periodStart: now, periodEnd } = activation;

      let tenantInvalidation = null;
      await withPlatformTransaction(async (session) => {
        const tenant = await Tenant.findOne({
          _id: req.params.id,
          isDeleted: { $ne: true },
          revision: expectedTenantRevision,
        }).session(session);
        if (!tenant) throw new Error("Tenant revision conflict.");
        tenantInvalidation = tenant.toObject ? tenant.toObject() : tenant;

        const subscription = await PlatformSubscription.findOne({
          tenantId: tenant._id,
          isDeleted: { $ne: true },
          revision: expectedSubscriptionRevision,
        }).session(session);
        if (!subscription) throw new Error("Subscription revision conflict.");

        const currentEffective = subscriptionEffectiveStatus(subscription, now);
        if (currentEffective === "active") throw new Error("This school subscription is already active.");
        assertSubscriptionTransition(currentEffective, "active");

        const nextRevision = expectedSubscriptionRevision + 1;
        const subUpdate = await PlatformSubscription.updateOne(
          { _id: subscription._id, revision: expectedSubscriptionRevision, isDeleted: { $ne: true } },
          {
            $set: {
              status: "active",
              currentPeriodStart: now,
              currentPeriodEnd: periodEnd,
              trialEndsAt: null,
              suspendedAt: null,
              cancelledAt: null,
              expiredAt: null,
              statusReason: "",
              migrationQuarantined: false,
              quarantineReason: "",
              updatedBy: req.user?._id || null,
            },
            $inc: { revision: 1 },
            $push: {
              history: historyEntry({
                action: "manual_activation_override",
                fromStatus: currentEffective,
                toStatus: "active",
                reason,
                actorId: req.user?._id || null,
                planId: subscription.planId,
                revision: nextRevision,
              }),
            },
          },
          { session },
        );
        if (subUpdate.modifiedCount !== 1) throw new Error("Subscription revision conflict.");

        const projectedSubscription = {
          ...(subscription.toObject ? subscription.toObject() : subscription),
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          trialEndsAt: null,
          suspendedAt: null,
          cancelledAt: null,
          expiredAt: null,
          statusReason: "",
          migrationQuarantined: false,
          quarantineReason: "",
          revision: nextRevision,
        };
        const projection = tenantProjectionFromSubscription(projectedSubscription);
        const tenantUpdate = await Tenant.updateOne(
          { _id: tenant._id, revision: expectedTenantRevision, isDeleted: { $ne: true } },
          {
            $set: {
              ...projection,
              status: "active",
              statusReason: "",
              suspendedAt: null,
              cancelledAt: null,
              updatedBy: req.user?._id || null,
            },
            $inc: { revision: 1 },
          },
          { session },
        );
        if (tenantUpdate.modifiedCount !== 1) throw new Error("Tenant revision conflict.");
      });

      const tenantAfter = await Tenant.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean().catch(() => null);
      await invalidateTenantCache(tenantInvalidation, tenantAfter);
      await writeAudit(req, {
        action: "Manual Activate Tenant",
        entityId: req.params.id,
        tenantId: req.params.id,
        description: `Manually activated tenant through ${periodEnd.toISOString()}`,
        meta: { periodEnd: periodEnd.toISOString(), reason, billingOverride: true },
      });
      return res.redirect(`/super-admin/schools/${req.params.id}`);
    } catch (err) {
      console.error("manualActivateTenant error:", err);
      const code = /revision conflict/i.test(String(err?.message || "")) ? 409 : 400;
      return res.status(code).send(err?.message || "Failed to manually activate school.");
    }
  },

  resendTenantInvite: async (req, res) => {
    try {
      const expectedRevision = positiveRevision(req.body.revision);
      const tenant = await Tenant.findOne({ _id: req.params.id, isDeleted: { $ne: true }, revision: expectedRevision }).populate("planId");
      if (!tenant) return res.status(409).send("School changed since the page was loaded. Reload and try again.");

      // Preflight the account state before invalidating any existing invite.
      const tenantConn = await getTenantConnection(tenant.dbName);
      const models = loadTenantModels(tenantConn);
      const adminUser = await findTenantAdminUser(models.User, tenant);
      if (!adminUser) return res.status(404).send("Tenant admin user not found.");
      if (adminUser.status !== "invited" || adminUser.passwordHash) return res.status(409).send("The tenant admin account is already initialized; use password reset instead.");

      const claim = await Tenant.updateOne(
        { _id: tenant._id, revision: expectedRevision, isDeleted: { $ne: true } },
        { $set: { "meta.invitePending": true, updatedBy: req.user?._id || null }, $inc: { revision: 1 } },
      );
      if (claim.modifiedCount !== 1) return res.status(409).send("School changed since the page was loaded. Reload and try again.");

      const result = await resendTenantAdminInvite({ tenant, req });
      await Tenant.updateOne(
        { _id: tenant._id, isDeleted: { $ne: true } },
        { $set: { "meta.inviteSentAt": new Date(), "meta.provisioningStatus": "ready" } },
      );
      await writeAudit(req, {
        action: "Resend Tenant Invite",
        entityId: tenant._id,
        tenantId: tenant._id,
        description: `Resent tenant admin invite for ${tenant.name}`,
        meta: { ownerEmail: tenant.ownerEmail, adminUserId: String(result.adminUser._id || "") },
      });
      return res.redirect(`/super-admin/schools/${tenant._id}?inviteResent=1`);
    } catch (err) {
      console.error("resendTenantInvite error:", err);
      return res.status(/revision/i.test(String(err?.message || "")) ? 409 : 400).send(err.message || "Failed to resend tenant invite.");
    }
  },

  deleteTenant: async (req, res) => {
    try {
      const expectedTenantRevision = positiveRevision(req.body.revision);
      const expectedSubscriptionRevision = positiveRevision(req.body.subscriptionRevision);
      let deletedTenantCache = null;
      await withPlatformTransaction(async (session) => {
        const tenant = await Tenant.findOne({ _id: req.params.id, isDeleted: { $ne: true }, revision: expectedTenantRevision }).session(session);
        if (!tenant) throw new Error("Tenant revision conflict.");
        deletedTenantCache = tenant.toObject ? tenant.toObject() : tenant;
        const subscription = await PlatformSubscription.findOne({ tenantId: tenant._id, isDeleted: { $ne: true }, revision: expectedSubscriptionRevision }).session(session);
        if (!subscription) throw new Error("Subscription revision conflict.");
        if (subscription.status !== "cancelled" || tenant.status !== "cancelled") {
          throw new Error("Cancel the subscription before deleting the school.");
        }

        const now = new Date();
        const subUpdate = await PlatformSubscription.updateOne(
          { _id: subscription._id, revision: expectedSubscriptionRevision, isDeleted: { $ne: true } },
          {
            $set: { isDeleted: true, deletedAt: now, updatedBy: req.user?._id || null },
            $inc: { revision: 1 },
            $push: { history: historyEntry({ action: "tenant_deleted", fromStatus: subscription.status, toStatus: subscription.status, actorId: req.user?._id || null, planId: subscription.planId, revision: expectedSubscriptionRevision + 1 }) },
          },
          { session },
        );
        if (subUpdate.modifiedCount !== 1) throw new Error("Subscription revision conflict.");

        const tenantUpdate = await Tenant.updateOne(
          { _id: tenant._id, revision: expectedTenantRevision, isDeleted: { $ne: true } },
          {
            $set: {
              status: "deleted",
              isDeleted: true,
              archivedAt: now,
              statusReason: safeTrim(req.body.reason || "Deleted after subscription cancellation"),
              "settings.profile.enabled": false,
              updatedBy: req.user?._id || null,
              subscriptionRevision: expectedSubscriptionRevision + 1,
            },
            $inc: { revision: 1 },
          },
          { session },
        );
        if (tenantUpdate.modifiedCount !== 1) throw new Error("Tenant revision conflict.");
      });
      await invalidateTenantCache(deletedTenantCache);
      await writeAudit(req, { action: "Delete Tenant", entityId: req.params.id, tenantId: req.params.id, description: "Deleted tenant after canonical subscription cancellation" });
      return res.redirect("/super-admin/schools");
    } catch (err) {
      console.error("deleteTenant error:", err);
      return res.status(/revision conflict/i.test(String(err?.message || "")) ? 409 : 400).send(err?.message || "Failed to delete tenant.");
    }
  },
};
