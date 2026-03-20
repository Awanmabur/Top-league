const jwt = require("jsonwebtoken");

function perf(label, startedAt) {
  if (process.env.DEBUG_PERF === "1") {
    console.log(`[tenantAuth] ${label}: ${Date.now() - startedAt}ms`);
  }
}

function tenantAuth(requiredRoles = []) {
  return function (req, res, next) {
    const totalStartedAt = Date.now();

    const tokenStartedAt = Date.now();
    const token =
      req.cookies.tenant_token ||
      req.headers["authorization"]?.split(" ")[1];
    perf("token read", tokenStartedAt);

    if (!token) return res.redirect("/login");

    try {
      const verifyStartedAt = Date.now();
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      perf("jwt verify", verifyStartedAt);

      const tenantCheckStartedAt = Date.now();
      if (!req.tenant || !req.tenant.code) {
        return res.status(500).send("Tenant context missing");
      }

      if (!payload.tenantCode || payload.tenantCode !== req.tenant.code) {
        res.clearCookie("tenant_token");
        return res.redirect("/login");
      }
      perf("tenant match", tenantCheckStartedAt);

      const roleStartedAt = Date.now();
      const roles = Array.isArray(payload.roles) ? payload.roles : [];

      if (
        requiredRoles.length &&
        !requiredRoles.some((r) => roles.includes(r))
      ) {
        return res.status(403).send("Forbidden");
      }
      perf("role check", roleStartedAt);

      req.user = payload;
      perf("total", totalStartedAt);
      return next();
    } catch (e) {
      console.error(e);
      res.clearCookie("tenant_token");
      return res.redirect("/login");
    }
  };
}

module.exports = { tenantAuth };