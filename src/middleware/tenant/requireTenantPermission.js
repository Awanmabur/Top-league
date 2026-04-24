const { tenantRoleCan } = require("../../utils/tenantRoles");

function wantsJson(req) {
  const accept = String(req.headers.accept || "");
  return accept.includes("application/json") || req.xhr;
}

module.exports = function requireTenantPermission(permission) {
  return function (req, res, next) {
    const role = req.user?.role || req.user?.roles?.[0] || "";

    if (tenantRoleCan(role, permission)) {
      return next();
    }

    if (wantsJson(req)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    req.flash?.("error", "You do not have permission to access that page.");
    return res.redirect("/admin/dashboard");
  };
};
