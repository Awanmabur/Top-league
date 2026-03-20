const { hasModule, isTenantOperational } = require("../../utils/tenantPlanAccess");

module.exports = function requireTenantModule(moduleName, options = {}) {
  const mode = options.mode || "html";

  return function tenantModuleGuard(req, res, next) {
    const access = req.tenantAccess;

    if (!access) {
      return res.status(500).send("Tenant access context is missing.");
    }

    if (!isTenantOperational(access)) {
      if (mode === "json") {
        return res.status(403).json({
          ok: false,
          error: "Tenant access is not active.",
        });
      }

      return res.status(403).render("tenant/errors/access-denied", {
        error: "This tenant is not active for operational access.",
      });
    }

    if (!hasModule(access, moduleName)) {
      if (mode === "json") {
        return res.status(403).json({
          ok: false,
          error: `Module ${moduleName} is not included in your plan.`,
        });
      }

      return res.status(403).render("tenant/errors/access-denied", {
        error: `${moduleName} is not included in your current plan.`,
      });
    }

    return next();
  };
};