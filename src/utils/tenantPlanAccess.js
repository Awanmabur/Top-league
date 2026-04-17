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
  "Subject",
  "TimetableEntry",
  "Attendance",
  "Assignment",
  "Exam",
  "Result",
  "Transcript",
  "AcademicEvent",
  "StudentDoc",
  "Enrollment",
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
    customDomain: flags.customDomain !== false,
    apiAccess: flags.apiAccess !== false,
    prioritySupport: flags.prioritySupport !== false,
    whiteLabel: flags.whiteLabel !== false,
    advancedReports: flags.advancedReports !== false,
    helpdesk: flags.helpdesk !== false,
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

function isTenantOperational(access) {
  return ["trial", "active"].includes(normalizeTenantStatus(access?.status));
}

function buildTenantAccess({ tenant, plan }) {
  const resolvedModules = getTenantModulesFromPlan(plan);

  return {
    tenantId: tenant?._id || null,
    tenant,
    plan,
    planCode: String(plan?.code || "").trim().toLowerCase(),
    planName: plan?.name || "",
    status: normalizeTenantStatus(tenant?.status),
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
