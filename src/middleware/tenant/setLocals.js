const { getSchoolUi } = require("../../utils/school-ui");

module.exports = function setLocals(req, res, next) {
  const tenantAccess = req.tenantAccess || res.locals.tenantAccess || null;
  const schoolLevel = tenantAccess?.schoolLevel || "high";

  res.locals.tenant = req.tenant || null;
  res.locals.tenantAccess = tenantAccess;
  res.locals.csrfToken = (typeof req.csrfToken === "function") ? req.csrfToken() : "";
  res.locals.user = req.user || null;
  res.locals.originalUrl = req.originalUrl || req.url || "";
  res.locals.currentPath = req.path || "";
  res.locals.ui = res.locals.ui || getSchoolUi(schoolLevel);

  next();
};