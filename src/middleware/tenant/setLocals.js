const { getSchoolUi } = require("../../utils/school-ui");
const { getPrimaryTenantRole, getTenantRoleAccess } = require("../../utils/tenantRoles");

module.exports = function setLocals(req, res, next) {
  const tenantAccess = req.tenantAccess || res.locals.tenantAccess || null;
  const schoolLevel = tenantAccess?.schoolLevel || "high";
  const primaryRole = getPrimaryTenantRole(req.user?.role || req.user?.roles || "");
  const roleAccess = getTenantRoleAccess(primaryRole);
  // The tenant model registry uses lazy getters. Do not dereference every key here:
  // doing so compiles the entire tenant schema graph on every request and defeats lazy loading.
  const availableModels = Object.keys(req.models || {});

  res.locals.tenant = req.tenant || null;
  res.locals.tenantAccess = tenantAccess;
  res.locals.csrfToken = (typeof req.csrfToken === "function") ? req.csrfToken() : "";
  res.locals.user = req.user || null;
  res.locals.primaryRole = primaryRole;
  res.locals.roleAccess = roleAccess;
  res.locals.availableModels = availableModels;
  res.locals.originalUrl = req.originalUrl || req.url || "";
  res.locals.currentPath = req.path || "";
  res.locals.ui = res.locals.ui || getSchoolUi(schoolLevel);

  next();
};
