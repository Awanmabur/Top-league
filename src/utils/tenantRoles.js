const TENANT_ROLES = [
  "admin",
  "registrar",
  "librarian",
  "hostel",
  "staff",
  "lecturer",
  "student",
  "parent",
  "finance",
];

const DEFAULT_TENANT_ROLE = "student";
const ADMIN_PORTAL_ROLES = ["admin", "finance", "librarian", "hostel", "registrar"];
const STAFF_PORTAL_ROLES = ["staff", "lecturer"];
const TENANT_ROLE_PRIORITY = [
  "admin",
  "registrar",
  "finance",
  "librarian",
  "hostel",
  "staff",
  "lecturer",
  "parent",
  "student",
];

const TENANT_ROLE_PERMISSIONS = {
  admin: ["*"],
  finance: [
    "dashboard.view",
    "reports.view",
    "notifications.view",
    "announcements.view",
    "announcements.manage",
    "profile.view",
    "finance.view",
    "finance.manage",
  ],
  librarian: [
    "dashboard.view",
    "notifications.view",
    "announcements.view",
    "announcements.manage",
    "profile.view",
    "library.view",
    "library.manage",
  ],
  hostel: [
    "dashboard.view",
    "notifications.view",
    "announcements.view",
    "announcements.manage",
    "profile.view",
    "hostels.view",
    "hostels.manage",
  ],
  registrar: [
    "dashboard.view",
    "reports.view",
    "notifications.view",
    "announcements.view",
    "announcements.manage",
    "profile.view",
    "messaging.view",
    "messaging.manage",
    "inquiries.view",
    "admissions.view",
    "admissions.manage",
    "students.view",
    "students.manage",
    "parents.view",
    "parents.manage",
    "promotions.view",
    "promotions.manage",
    "studentDocs.view",
    "studentDocs.manage",
    "discipline.view",
    "discipline.manage",
    "subjects.view",
    "subjects.manage",
    "classes.view",
    "classes.manage",
    "sections.view",
    "sections.manage",
    "streams.view",
    "streams.manage",
    "exams.view",
    "exams.manage",
    "results.view",
    "results.manage",
    "transcripts.view",
    "transcripts.manage",
    "assignments.view",
    "assignments.manage",
    "attendance.view",
    "attendance.manage",
    "timetable.view",
    "timetable.manage",
    "academicCalendar.view",
    "academicCalendar.manage",
  ],
  staff: ["staffPortal.view"],
  lecturer: ["staffPortal.view"],
  student: ["studentPortal.view"],
  parent: ["parentPortal.view"],
};

function cleanRole(role) {
  return String(role || "").trim().toLowerCase();
}

function normalizeTenantRoles(input) {
  const list = Array.isArray(input) ? input : input ? [input] : [];
  const seen = new Set();
  const valid = new Set();

  for (const item of list) {
    const role = cleanRole(item);
    if (!TENANT_ROLES.includes(role) || seen.has(role)) continue;
    seen.add(role);
    valid.add(role);
  }

  if (!valid.size) return [DEFAULT_TENANT_ROLE];

  const primaryRole =
    TENANT_ROLE_PRIORITY.find((role) => valid.has(role)) || DEFAULT_TENANT_ROLE;

  return [primaryRole];
}

function getPrimaryTenantRole(input) {
  return normalizeTenantRoles(input)[0];
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

function getTenantPermissions(role) {
  return TENANT_ROLE_PERMISSIONS[getPrimaryTenantRole(role)] || [];
}

function tenantRoleCan(role, permission) {
  return getTenantPermissions(role).some((granted) => permissionMatches(granted, permission));
}

function getTenantRoleAccess(role) {
  const normalizedRole = getPrimaryTenantRole(role);
  const permissions = getTenantPermissions(normalizedRole);

  return {
    role: normalizedRole,
    permissions,
    can(permission) {
      return permissions.some((granted) => permissionMatches(granted, permission));
    },
  };
}

function getTenantDashboardRedirect(role) {
  const primaryRole = getPrimaryTenantRole(role);

  if (ADMIN_PORTAL_ROLES.includes(primaryRole)) return "/admin/dashboard";
  if (STAFF_PORTAL_ROLES.includes(primaryRole)) return "/staff/dashboard";
  if (primaryRole === "parent") return "/parent/dashboard";
  return "/student/dashboard";
}

module.exports = {
  TENANT_ROLES,
  DEFAULT_TENANT_ROLE,
  ADMIN_PORTAL_ROLES,
  STAFF_PORTAL_ROLES,
  TENANT_ROLE_PERMISSIONS,
  normalizeTenantRoles,
  getPrimaryTenantRole,
  getTenantPermissions,
  tenantRoleCan,
  getTenantRoleAccess,
  getTenantDashboardRedirect,
};

