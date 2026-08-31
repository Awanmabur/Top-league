const { tenantRoleCan, TENANT_ROLE_PERMISSIONS, permissionMatches } = require("../../utils/tenantRoles");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Modules where at least one role is granted "<module>.manage" support the
// view/manage split. Modules that never grant a ".manage" variant (e.g.
// profile, reports, inquiries) only ever modeled a single permission, so
// leave those untouched to avoid locking out mutating routes nobody can
// currently satisfy with ".manage".
const MODULES_WITH_MANAGE_SPLIT = new Set(
  Object.values(TENANT_ROLE_PERMISSIONS)
    .flat()
    .filter((p) => p.endsWith(".manage"))
    .map((p) => p.replace(/\.manage$/, "")),
);

function wantsJson(req) {
  const accept = String(req.headers.accept || "");
  // See requireTenantAuth.js: offline-replayed requests must get a JSON 403
  // instead of a flash+redirect, or the queue reads the followed redirect's
  // 200 as a false "success" and discards the queued submission.
  return accept.includes("application/json") || req.xhr || req.headers["x-offline-replay"] === "1";
}

// A role granted only "<module>.view" can read a module but must not be able to
// mutate it. Routes are mounted once per module with a single ".view" permission,
// so a non-GET request escalates the requirement to ".manage" here rather than
// requiring every route file to be wired with a second permission check.
function permissionForRequest(permission, method) {
  if (SAFE_METHODS.has(String(method || "GET").toUpperCase())) return permission;
  if (!permission.endsWith(".view")) return permission;

  const base = permission.replace(/\.view$/, "");
  if (!MODULES_WITH_MANAGE_SPLIT.has(base)) return permission;

  return `${base}.manage`;
}

module.exports = function requireTenantPermission(permission) {
  return function (req, res, next) {
    const role = req.user?.role || req.user?.roles?.[0] || "";
    const effectivePermission = permissionForRequest(permission, req.method);

    const builtInAllowed = tenantRoleCan(role, effectivePermission);
    const customPermissions = Array.isArray(req.user?.accessPermissions)
      ? req.user.accessPermissions
      : null;
    const customAllowed = customPermissions === null
      ? true
      : customPermissions.some((granted) => permissionMatches(granted, effectivePermission));

    // Custom Staff Roles are a restrictive layer only. They can reduce a
    // built-in tenant role's authority but can never expand it. Tenant Admin
    // keeps the built-in wildcard and is never restricted by a staff role.
    if (builtInAllowed && (role === "admin" || customAllowed)) {
      return next();
    }

    if (wantsJson(req)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    req.flash?.("error", "You do not have permission to access that page.");
    return res.redirect("/admin/dashboard");
  };
};
