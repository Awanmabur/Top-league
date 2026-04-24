const PLATFORM_ROLES = [
  "SuperAdmin",
  "Support",
  "Sales",
  "Finance",
  "Operations",
];

const PLATFORM_ROLE_PERMISSIONS = {
  SuperAdmin: ["*"],
  Operations: [
    "dashboard.view",
    "schools.view",
    "schools.manage",
    "announcements.view",
    "announcements.manage",
    "reports.view",
    "support.view",
    "support.manage",
    "settings.view",
    "settings.manage",
  ],
  Support: [
    "dashboard.view",
    "schools.view",
    "announcements.view",
    "support.view",
    "support.manage",
  ],
  Sales: [
    "dashboard.view",
    "schools.view",
    "schools.manage",
    "plans.view",
    "reports.view",
  ],
  Finance: [
    "dashboard.view",
    "schools.view",
    "plans.view",
    "billing.view",
    "billing.manage",
    "reports.view",
  ],
};

function normalizePlatformRole(role) {
  const value = String(role || "").trim();
  return PLATFORM_ROLES.includes(value) ? value : "Support";
}

function permissionMatches(granted, required) {
  if (!granted || !required) return false;
  if (granted === "*" || granted === required) return true;

  const grantedBase = granted.replace(/\.(view|manage)$/, "");
  const requiredBase = required.replace(/\.(view|manage)$/, "");

  if (granted.endsWith(".manage") && required.endsWith(".view")) {
    return grantedBase === requiredBase;
  }

  return false;
}

function getPlatformPermissions(role) {
  return PLATFORM_ROLE_PERMISSIONS[normalizePlatformRole(role)] || [];
}

function platformCan(role, permission) {
  const permissions = getPlatformPermissions(role);
  return permissions.some((granted) => permissionMatches(granted, permission));
}

function getPlatformAccess(role) {
  const normalizedRole = normalizePlatformRole(role);
  const permissions = getPlatformPermissions(normalizedRole);

  return {
    role: normalizedRole,
    permissions,
    can(permission) {
      return permissions.some((granted) => permissionMatches(granted, permission));
    },
  };
}

function getPlatformDashboardRedirect(role) {
  return "/super-admin/dashboard";
}

module.exports = {
  PLATFORM_ROLES,
  PLATFORM_ROLE_PERMISSIONS,
  normalizePlatformRole,
  getPlatformPermissions,
  platformCan,
  getPlatformAccess,
  getPlatformDashboardRedirect,
};
