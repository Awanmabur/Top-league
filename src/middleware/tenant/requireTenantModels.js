function wantsJson(req) {
  const accept = String(req.headers.accept || "");
  return accept.includes("application/json") || req.xhr;
}

module.exports = function requireTenantModels(modelNames, options = {}) {
  const names = Array.isArray(modelNames) ? modelNames.filter(Boolean) : [modelNames].filter(Boolean);
  const match = options.match === "all" ? "all" : "any";

  return function tenantModelGuard(req, res, next) {
    if (!req.models) {
      return res.status(500).send("Tenant models are not loaded.");
    }

    const present = names.filter((name) => Boolean(req.models?.[name]));
    const allowed = match === "all" ? present.length === names.length : present.length > 0;

    if (allowed) return next();

    if (wantsJson(req)) {
      return res.status(404).json({
        ok: false,
        error: "This module is not available for the current tenant setup.",
      });
    }

    return res.status(404).render("platform/public/404", {
      error: "This module is not available for the current tenant setup.",
    });
  };
};
