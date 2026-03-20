module.exports = async function loadPlatformTenant(req, res, next) {
  try {
    const { Tenant } = req.platformModels;
    const code = req.tenant?.code || req.tenantCode;
    if (!code) return res.status(400).send("Tenant not resolved");

    const tenantPlatform = await Tenant.findOne({ code: String(code).toLowerCase() });
    if (!tenantPlatform) return res.status(404).send("Platform tenant not found");

    req.tenantPlatform = tenantPlatform;
    next();
  } catch (e) {
    next(e);
  }
};
