const FREE_PROFILE_MODULES = [
  "Setting",
  "Announcement",
  "SchoolFAQ",
  "SchoolInquiry",
  "SchoolReview",
  "Program",
];

function uniqueModules(...groups) {
  return [...new Set(groups.flat().filter(Boolean).map((x) => String(x).trim()))];
}

function getTenantModulesFromPlan(plan) {
  return uniqueModules(
    FREE_PROFILE_MODULES,
    Array.isArray(plan?.enabledModules) ? plan.enabledModules : []
  );
}

function getPlanFeatureFlags(plan) {
  return {
    customDomain: !!plan?.featureFlags?.customDomain,
    apiAccess: !!plan?.featureFlags?.apiAccess,
    prioritySupport: !!plan?.featureFlags?.prioritySupport,
    whiteLabel: !!plan?.featureFlags?.whiteLabel,
    advancedReports: !!plan?.featureFlags?.advancedReports,
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

function hasModule(access, moduleName) {
  return Array.isArray(access?.modules) && access.modules.includes(moduleName);
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
  uniqueModules,
  getTenantModulesFromPlan,
  getPlanFeatureFlags,
  getPlanLimits,
  normalizeTenantStatus,
  hasModule,
  hasFeature,
  isTenantOperational,
  buildTenantAccess,
};