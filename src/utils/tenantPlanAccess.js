const FREE_PROFILE_MODULES = [
  "Setting",
  "Announcement",
  "SchoolFAQ",
  "SchoolInquiry",
  "SchoolReview",
];

const SCHOOL_BASELINE_MODULES = [
  "User",
  "StaffRole",
  "Staff",
  "Student",
  "Parent",
  "Class",
  "Section",
  "Stream",
  "Subject",
  "TimetableEntry",
  "Attendance",
  "Assignment",
  "Exam",
  "Result",
  "Transcript",
  "AcademicEvent",
  "StudentDoc",
  "PromotionLog",
  "Applicant",
  "Intake",
  "AdmissionRequirement",
  "OfferLetter",
  "Invoice",
  "Payment",
  "FeeStructure",
  "Scholarship",
  "Notification",
  "LibraryBook",
  "Hostel",
  "Transport",
  "Asset",
  "Event",
  "ReportExport",
  "Expense",
  "Message",
  "HelpdeskTicket",
  "AuditLog",
  "BackupJob",
  "ApiIntegration",
  "SystemHealth",
];

const MODULE_ALIASES = {
  Stream: ["Stream", "Section"],
  Section: ["Section", "Stream"],
  FeeStructure: ["FeeStructure", "Fees"],
  Fees: ["Fees", "FeeStructure"],
  ReportCard: ["ReportCard", "Transcript"],
  Transcript: ["Transcript", "ReportCard"],
};

function uniqueModules(...groups) {
  return [...new Set(groups.flat().filter(Boolean).map((x) => String(x).trim()))];
}

function getTenantModulesFromPlan(plan) {
  return uniqueModules(
    FREE_PROFILE_MODULES,
    SCHOOL_BASELINE_MODULES,
    Array.isArray(plan?.enabledModules) ? plan.enabledModules : []
  );
}

function getPlanFeatureFlags(plan) {
  const flags = plan?.featureFlags || {};

  return {
    // Premium/sensitive capabilities fail closed unless explicitly enabled.
    customDomain: flags.customDomain === true,
    apiAccess: flags.apiAccess === true,
    prioritySupport: flags.prioritySupport === true,
    whiteLabel: flags.whiteLabel === true,
    advancedReports: flags.advancedReports === true,
    helpdesk: flags.helpdesk === true,
    // Operational safety features historically default on; the platform
    // migration materializes those defaults so snapshots remain explicit.
    backups: flags.backups !== false,
    systemHealth: flags.systemHealth !== false,
  };
}

function getPlanLimits(plan) {
  return {
    maxStudents: Number(plan?.maxStudents || 0),
    maxStaff: Number(plan?.maxStaff || 0),
    maxCampuses: Number(plan?.maxCampuses || 0),
  };
}

function normalizeTenantStatus(status) {
  const clean = String(status || "").trim().toLowerCase();
  if (["trial", "active", "suspended", "cancelled"].includes(clean)) return clean;
  return "trial";
}

function normalizeSchoolLevel(level) {
  const clean = String(level || "").trim().toLowerCase();
  if (["nursery", "primary", "high"].includes(clean)) return clean;
  return "high";
}

function hasModule(access, moduleName) {
  if (!Array.isArray(access?.modules)) return false;
  const accepted = MODULE_ALIASES[moduleName] || [moduleName];
  return accepted.some((name) => access.modules.includes(name));
}

function hasFeature(access, featureName) {
  return !!access?.featureFlags?.[featureName];
}

function isTenantOperational(access, now = new Date()) {
  const status = normalizeTenantStatus(access?.status);
  if (!["trial", "active"].includes(status)) return false;

  const current = new Date(now);
  if (status === "trial" && access?.trialEndsAt) {
    const trialEnd = new Date(access.trialEndsAt);
    if (!Number.isNaN(trialEnd.getTime()) && trialEnd <= current) return false;
  }

  if (status === "active" && access?.subscriptionEndsAt) {
    const periodEnd = new Date(access.subscriptionEndsAt);
    if (!Number.isNaN(periodEnd.getTime()) && periodEnd <= current) return false;
  }

  return true;
}

function buildTenantAccess({ tenant, plan, subscription = null }) {
  const resolvedModules = getTenantModulesFromPlan(plan);
  const status = String(subscription?.status || tenant?.status || "").trim().toLowerCase();

  return {
    tenantId: tenant?._id || null,
    tenant,
    plan,
    subscription,
    subscriptionId: subscription?._id || tenant?.subscriptionId || null,
    subscriptionRevision: Number(subscription?.revision || tenant?.subscriptionRevision || 1),
    planCode: String(plan?.code || "").trim().toLowerCase(),
    planName: plan?.name || "",
    status: normalizeTenantStatus(status === "expired" || status === "past_due" ? "suspended" : status),
    subscriptionStatus: status || normalizeTenantStatus(tenant?.status),
    trialEndsAt: subscription?.trialEndsAt || tenant?.trialEndsAt || null,
    subscriptionStartsAt: subscription?.currentPeriodStart || tenant?.subscriptionStartsAt || null,
    subscriptionEndsAt: subscription?.currentPeriodEnd || tenant?.subscriptionEndsAt || null,
    schoolLevel: normalizeSchoolLevel(
      tenant?.settings?.schoolLevel || tenant?.schoolLevel
    ),
    modules: resolvedModules,
    featureFlags: getPlanFeatureFlags(plan),
    limits: getPlanLimits(plan),
    profile: {
      enabled: !!tenant?.settings?.profile?.enabled,
      verified: !!tenant?.settings?.profile?.verified,
    },
    invitePending: !!tenant?.meta?.invitePending,
  };
}

module.exports = {
  FREE_PROFILE_MODULES,
  SCHOOL_BASELINE_MODULES,
  MODULE_ALIASES,
  uniqueModules,
  getTenantModulesFromPlan,
  getPlanFeatureFlags,
  getPlanLimits,
  normalizeTenantStatus,
  normalizeSchoolLevel,
  hasModule,
  hasFeature,
  isTenantOperational,
  buildTenantAccess,
};
