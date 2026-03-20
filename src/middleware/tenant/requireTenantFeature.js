const { hasFeature, isTenantOperational } = require("../../utils/tenantPlanAccess");

module.exports = function requireTenantFeature(featureName, options = {}) {
  const mode = options.mode || "html";

  return function tenantFeatureGuard(req, res, next) {
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

    if (!hasFeature(access, featureName)) {
      if (mode === "json") {
        return res.status(403).json({
          ok: false,
          error: `Feature ${featureName} is not enabled in your plan.`,
        });
      }

      return res.status(403).render("tenant/errors/access-denied", {
        error: `${featureName} is not enabled in your current plan.`,
      });
    }

    return next();
  };
};