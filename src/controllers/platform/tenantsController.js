const { platformConnection, getTenantConnection } = require("../../config/db");
const { sendMail } = require("../../utils/mailer");
const { getTenantModulesFromPlan } = require("../../utils/tenantPlanAccess");
const { createSetPasswordInvite } = require("../../utils/inviteService");

const Tenant = require("../../models/platform/Tenant")(platformConnection);
const Plan = require("../../models/platform/Plan")(platformConnection);
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
  return User.findOne({ email: safeLower(tenant.ownerEmail), deletedAt: null });
}

async function resendTenantAdminInvite({ tenant, req }) {
  const tenantConn = await getTenantConnection(tenant.dbName);
  const models = loadTenantModels(tenantConn);
  const User = models.User;
  const InviteToken = models.InviteToken;
  if (!User || !InviteToken) throw new Error("Tenant invite models are not available.");

  const adminUser = await findTenantAdminUser(User, tenant);
  if (!adminUser) throw new Error("Tenant admin user not found.");

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

      const tenants = tenantsRaw.map(hydrateTenantForView);
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
      const plans = await loadActivePlans();
      return res.render("platform/tenants/create", {
        plans,
        old: req.body || {},
        error: null,
        schoolTypeOptions: SCHOOL_TYPE_OPTIONS,
        schoolCategoryOptions: SCHOOL_CATEGORY_OPTIONS,
        schoolLevelOptions: SCHOOL_LEVEL_OPTIONS,
        schoolSectionOptions: SCHOOL_SECTION_OPTIONS,
      });
    } catch (err) {
      console.error("createTenantForm error:", err);
      return res.status(500).render("platform/tenants/create", {
        plans: [], old: req.body || {}, error: "Failed to load create school form.",
        schoolTypeOptions: SCHOOL_TYPE_OPTIONS, schoolCategoryOptions: SCHOOL_CATEGORY_OPTIONS,
        schoolLevelOptions: SCHOOL_LEVEL_OPTIONS, schoolSectionOptions: SCHOOL_SECTION_OPTIONS,
      });
    }
  },

  createTenant: async (req, res) => {
    let createdTenant = null;
    try {
      const { code, name, ownerName, ownerEmail, ownerPhone, country, timezone, currency, planId, status, customDomain, trialEndsAt } = req.body;
      const cleanName = safeTrim(name);
      const cleanCode = slugify(code);
      const cleanOwnerName = safeTrim(ownerName);
      const cleanOwnerEmail = safeLower(ownerEmail);
      const cleanOwnerPhone = safeTrim(ownerPhone);
      const cleanCountry = safeTrim(country);
      const cleanTimezone = safeTrim(timezone) || "Africa/Kampala";
      const cleanCurrency = safeTrim(currency || "USD").toUpperCase();
      const cleanStatus = safeLower(status || "trial");
      const cleanCustomDomain = safeLower(customDomain);

      if (!cleanName || !cleanCode || !cleanOwnerName || !cleanOwnerEmail || !planId) {
        return res.status(400).render("platform/tenants/create", {
          plans: await loadActivePlans(), old: req.body, error: "Name, code, owner name, owner email and plan are required.",
          schoolTypeOptions: SCHOOL_TYPE_OPTIONS, schoolCategoryOptions: SCHOOL_CATEGORY_OPTIONS,
          schoolLevelOptions: SCHOOL_LEVEL_OPTIONS, schoolSectionOptions: SCHOOL_SECTION_OPTIONS,
        });
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

      const academicPayload = buildAcademicPayload(req.body, cleanName);
      const baseDomain = safeLower(process.env.BASE_DOMAIN || "");
      const subdomain = baseDomain ? `${cleanCode}.${baseDomain}` : cleanCode;
      const dbName = `uni_${cleanCode}`;

      createdTenant = await Tenant.create({
        name: cleanName,
        code: cleanCode,
        subdomain,
        dbName,
        customDomain: cleanCustomDomain || undefined,
        planId: plan._id,
        planName: plan.name || "",
        status: ["trial", "active", "suspended", "cancelled"].includes(cleanStatus) ? cleanStatus : "trial",
        ownerName: cleanOwnerName,
        ownerEmail: cleanOwnerEmail,
        ownerPhone: cleanOwnerPhone || undefined,
        country: cleanCountry || undefined,
        timezone: cleanTimezone,
        currency: cleanCurrency,
        trialEndsAt: trialEndsAt || undefined,
        settings: {
          branding: { primaryColor: "#0a3d62", accentColor: "#0a6fbf" },
          profile: { enabled: true, verified: false },
          academics: academicPayload,
          modules: getTenantModulesFromPlan(plan),
        },
        meta: { onboardingCompleted: false, provisioningVersion: 3, invitePending: true },
        createdBy: req.user?._id || null,
        updatedBy: req.user?._id || null,
      });

      const tenantConn = await getTenantConnection(dbName);
      const models = loadTenantModels(tenantConn);
      const User = models.User;
      const InviteToken = models.InviteToken;
      if (!User || !InviteToken) throw new Error("Tenant user/invite models are not available.");

      const { firstName, lastName } = splitName(cleanOwnerName);
      await User.create({
        firstName,
        lastName,
        email: cleanOwnerEmail,
        roles: ["admin"],
        status: "invited",
        passwordHash: null,
        tokenVersion: 0,
      });

      const invite = await createSetPasswordInvite({
        req,
        InviteToken,
        userId: (await findTenantAdminUser(User, createdTenant))._id,
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

      await writeAudit(req, {
        action: "Create Tenant",
        entityId: createdTenant._id,
        tenantId: createdTenant._id,
        description: `Created tenant ${createdTenant.name} (${createdTenant.code}) and sent admin invite`,
        meta: {
          tenantCode: createdTenant.code,
          ownerEmail: createdTenant.ownerEmail,
          planId: String(createdTenant.planId || ""),
          modules: getTenantModulesFromPlan(plan),
          schoolUnits: academicPayload.schoolUnits.length,
          campuses: academicPayload.campuses.length,
        },
      });

      return res.render("platform/tenants/success", {
        tenant: hydrateTenantForView(createdTenant.toObject ? createdTenant.toObject() : createdTenant),
        inviteSent: true,
        invitedEmail: cleanOwnerEmail,
        loginUrl,
        error: null,
      });
    } catch (err) {
      console.error("createTenant error:", err);
      if (createdTenant?._id) {
        try { await Tenant.deleteOne({ _id: createdTenant._id }); } catch (_) {}
      }
      return res.status(500).render("platform/tenants/create", {
        plans: await loadActivePlans(), old: req.body, error: err?.message || "Failed to create school and send admin invite.",
        schoolTypeOptions: SCHOOL_TYPE_OPTIONS, schoolCategoryOptions: SCHOOL_CATEGORY_OPTIONS,
        schoolLevelOptions: SCHOOL_LEVEL_OPTIONS, schoolSectionOptions: SCHOOL_SECTION_OPTIONS,
      });
    }
  },

  showTenant: async (req, res) => {
    try {
      const tenantRaw = await Tenant.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).populate("planId").lean();
      if (!tenantRaw) {
        return res.status(404).render("platform/tenants/show", { tenant: null, error: "School not found.", inviteResent: false });
      }
      return res.render("platform/tenants/show", { tenant: hydrateTenantForView(tenantRaw), error: null, inviteResent: req.query.inviteResent === "1" });
    } catch (err) {
      console.error("showTenant error:", err);
      return res.status(500).render("platform/tenants/show", { tenant: null, error: "Failed to load school details.", inviteResent: false });
    }
  },

  editTenantForm: async (req, res) => {
    try {
      const [tenantRaw, plans] = await Promise.all([
        Tenant.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean(),
        loadActivePlans(),
      ]);
      if (!tenantRaw) {
        return res.status(404).render("platform/tenants/edit", {
          tenant: null, plans, error: "School not found.",
          schoolTypeOptions: SCHOOL_TYPE_OPTIONS, schoolCategoryOptions: SCHOOL_CATEGORY_OPTIONS,
          schoolLevelOptions: SCHOOL_LEVEL_OPTIONS, schoolSectionOptions: SCHOOL_SECTION_OPTIONS,
        });
      }
      return res.render("platform/tenants/edit", {
        tenant: hydrateTenantForView(tenantRaw), plans, error: null,
        schoolTypeOptions: SCHOOL_TYPE_OPTIONS, schoolCategoryOptions: SCHOOL_CATEGORY_OPTIONS,
        schoolLevelOptions: SCHOOL_LEVEL_OPTIONS, schoolSectionOptions: SCHOOL_SECTION_OPTIONS,
      });
    } catch (err) {
      console.error("editTenantForm error:", err);
      return res.status(500).render("platform/tenants/edit", {
        tenant: null, plans: [], error: "Failed to load edit school form.",
        schoolTypeOptions: SCHOOL_TYPE_OPTIONS, schoolCategoryOptions: SCHOOL_CATEGORY_OPTIONS,
        schoolLevelOptions: SCHOOL_LEVEL_OPTIONS, schoolSectionOptions: SCHOOL_SECTION_OPTIONS,
      });
    }
  },

  updateTenant: async (req, res) => {
    try {
      const tenant = await Tenant.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
      if (!tenant) return res.status(404).send("School not found.");

      const { name, ownerName, ownerEmail, ownerPhone, country, timezone, currency, planId, status, customDomain, profileEnabled, profileVerified } = req.body;
      const cleanName = safeTrim(name);
      const cleanOwnerName = safeTrim(ownerName);
      const cleanOwnerEmail = safeLower(ownerEmail);
      const cleanStatus = safeLower(status || tenant.status);
      const cleanCustomDomain = safeLower(customDomain);

      if (!cleanName || !cleanOwnerName || !cleanOwnerEmail || !planId) throw new Error("Name, owner name, owner email and plan are required.");

      const duplicate = await Tenant.findOne({
        _id: { $ne: tenant._id },
        $or: [{ ownerEmail: cleanOwnerEmail }, ...(cleanCustomDomain ? [{ customDomain: cleanCustomDomain }] : [])],
        isDeleted: { $ne: true },
      }).lean();
      if (duplicate) throw new Error("Owner email or custom domain is already used by another school.");

      const plan = await Plan.findOne({ _id: planId, isActive: true, isDeleted: { $ne: true } }).lean();
      if (!plan) throw new Error("Selected plan is invalid or inactive.");

      tenant.name = cleanName;
      tenant.ownerName = cleanOwnerName;
      tenant.ownerEmail = cleanOwnerEmail;
      tenant.ownerPhone = safeTrim(ownerPhone) || undefined;
      tenant.country = safeTrim(country) || undefined;
      tenant.timezone = safeTrim(timezone) || "Africa/Kampala";
      tenant.currency = safeTrim(currency || tenant.currency || "USD").toUpperCase();
      tenant.customDomain = cleanCustomDomain || undefined;
      tenant.planId = plan._id;
      tenant.planName = plan.name || tenant.planName || "";
      tenant.status = ["trial", "active", "suspended", "cancelled"].includes(cleanStatus) ? cleanStatus : tenant.status;

      tenant.settings = tenant.settings || {};
      tenant.settings.profile = tenant.settings.profile || {};
      tenant.settings.profile.enabled = isTruthy(profileEnabled);
      tenant.settings.profile.verified = isTruthy(profileVerified);
      tenant.settings.academics = buildAcademicPayload(req.body, cleanName);
      tenant.settings.modules = getTenantModulesFromPlan(plan);
      tenant.updatedBy = req.user?._id || null;
      await tenant.save();

      await writeAudit(req, {
        action: "Update Tenant",
        entityId: tenant._id,
        tenantId: tenant._id,
        description: `Updated tenant ${tenant.name}`,
        meta: {
          planId: String(tenant.planId || ""),
          status: tenant.status,
          modules: tenant.settings.modules,
          schoolUnits: tenant.settings.academics?.schoolUnits?.length || 0,
        },
      });

      return res.redirect(`/super-admin/schools/${tenant._id}`);
    } catch (err) {
      console.error("updateTenant error:", err);
      return res.status(500).render("platform/tenants/edit", {
        tenant: hydrateTenantForView({ ...req.body, _id: req.params.id }),
        plans: await loadActivePlans(),
        error: err?.message || "Failed to update school.",
        schoolTypeOptions: SCHOOL_TYPE_OPTIONS, schoolCategoryOptions: SCHOOL_CATEGORY_OPTIONS,
        schoolLevelOptions: SCHOOL_LEVEL_OPTIONS, schoolSectionOptions: SCHOOL_SECTION_OPTIONS,
      });
    }
  },

  updateTenantStatus: async (req, res) => {
    try {
      const tenant = await Tenant.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
      if (!tenant) return res.status(404).send("School not found.");
      const nextStatus = safeLower(req.body.status);
      if (!["trial", "active", "suspended", "cancelled"].includes(nextStatus)) return res.status(400).send("Invalid tenant status.");
      tenant.status = nextStatus;
      tenant.updatedBy = req.user?._id || null;
      await tenant.save();
      await writeAudit(req, { action: "Update Tenant Status", entityId: tenant._id, tenantId: tenant._id, description: `Changed ${tenant.name} status to ${tenant.status}`, meta: { status: tenant.status } });
      return res.redirect(`/super-admin/schools/${tenant._id}`);
    } catch (err) {
      console.error("updateTenantStatus error:", err);
      return res.status(500).send("Failed to update tenant status.");
    }
  },

  resendTenantInvite: async (req, res) => {
    try {
      const tenant = await Tenant.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).populate("planId");
      if (!tenant) return res.status(404).send("School not found.");
      const result = await resendTenantAdminInvite({ tenant, req });
      tenant.meta = tenant.meta || {};
      tenant.meta.invitePending = true;
      tenant.updatedBy = req.user?._id || null;
      await tenant.save();
      await writeAudit(req, { action: "Resend Tenant Invite", entityId: tenant._id, tenantId: tenant._id, description: `Resent tenant admin invite for ${tenant.name}`, meta: { ownerEmail: tenant.ownerEmail, adminUserId: String(result.adminUser._id || "") } });
      return res.redirect(`/super-admin/schools/${tenant._id}?inviteResent=1`);
    } catch (err) {
      console.error("resendTenantInvite error:", err);
      return res.status(500).send(err.message || "Failed to resend tenant invite.");
    }
  },

  deleteTenant: async (req, res) => {
    try {
      const tenant = await Tenant.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
      if (!tenant) return res.status(404).send("School not found.");
      tenant.status = "deleted";
      tenant.isDeleted = true;
      tenant.archivedAt = new Date();
      tenant.updatedBy = req.user?._id || null;
      await tenant.save();
      await writeAudit(req, { action: "Delete Tenant", entityId: tenant._id, tenantId: tenant._id, description: `Deleted tenant ${tenant.name}` });
      return res.redirect("/super-admin/schools");
    } catch (err) {
      console.error("deleteTenant error:", err);
      return res.status(500).send("Failed to delete tenant.");
    }
  },
};
