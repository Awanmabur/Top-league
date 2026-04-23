const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

function getBearerToken(req) {
  const h = req.headers["authorization"];
  if (!h) return null;
  const [type, token] = h.split(" ");
  return type?.toLowerCase() === "bearer" ? token : null;
}

function wantsJson(req) {
  const accept = String(req.headers.accept || "");
  return accept.includes("application/json") || req.xhr;
}

function safeLower(s) {
  return String(s || "").trim().toLowerCase();
}

function shouldSetDomain(hostname, baseDomain) {
  if (!hostname || !baseDomain) return false;
  const h = safeLower(hostname);
  const b = safeLower(baseDomain);
  if (h === "localhost" || h.endsWith(".localhost")) return false;
  return h === b || h.endsWith("." + b);
}

function cookieOptions(req) {
  const baseDomain = process.env.BASE_DOMAIN;
  const hostname = req.hostname;

  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  };

  if (
    process.env.NODE_ENV === "production" &&
    shouldSetDomain(hostname, baseDomain)
  ) {
    opts.domain = "." + safeLower(baseDomain);
  }

  return opts;
}

function clearTenantCookies(req, res, tenantCode) {
  const opts = cookieOptions(req);
  res.clearCookie("tenant_token", opts);
  if (tenantCode) res.clearCookie(`tenant_token.${tenantCode}`, opts);
}

function perf(label, startedAt) {
  if (process.env.DEBUG_PERF === "1") {
    console.log(`[requireTenantAuth] ${label}: ${Date.now() - startedAt}ms`);
  }
}

const USER_CACHE = new Map();
const USER_CACHE_TTL_MS = 60 * 1000;

function userCacheKey(tenantCode, userId) {
  return `${tenantCode}:${userId}`;
}

function getCachedUser(tenantCode, userId) {
  const key = userCacheKey(tenantCode, userId);
  const hit = USER_CACHE.get(key);
  if (!hit) return null;

  if (Date.now() > hit.exp) {
    USER_CACHE.delete(key);
    return null;
  }

  return hit.user;
}

function setCachedUser(tenantCode, userId, user) {
  USER_CACHE.set(userCacheKey(tenantCode, userId), {
    user,
    exp: Date.now() + USER_CACHE_TTL_MS,
  });
}

function deleteCachedUser(tenantCode, userId) {
  USER_CACHE.delete(userCacheKey(tenantCode, userId));
}

module.exports = function requireTenantAuth(requiredRole = null) {
  return async function (req, res, next) {
    const totalStartedAt = Date.now();

    if (!req.tenant?.code) {
      req.flash?.("error", "Tenant context missing");
      return res.status(500).send("Tenant context missing");
    }

    if (!req.models?.User) {
      req.flash?.("error", "Tenant models missing");
      return res.status(500).send("Tenant models missing");
    }

    const tenantCode = safeLower(req.tenant.code);
    const cookieName = `tenant_token.${tenantCode}`;

    const tokenStartedAt = Date.now();
    const token =
      req.cookies?.[cookieName] ||
      req.cookies?.tenant_token ||
      getBearerToken(req);
    perf("token read", tokenStartedAt);

    if (!token) {
      if (wantsJson(req)) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      req.flash?.("warning", "Please login to continue.");
      return res.redirect("/login");
    }

    try {
      const verifyStartedAt = Date.now();
      const payload = jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ["HS256"],
        issuer: "classic-academy",
        audience: "tenant",
      });
      perf("jwt verify", verifyStartedAt);

      const tenantCheckStartedAt = Date.now();
      if (!payload.tenantCode || safeLower(payload.tenantCode) !== tenantCode) {
        clearTenantCookies(req, res, tenantCode);
        if (wantsJson(req)) {
          return res.status(401).json({ message: "Unauthorized" });
        }
        req.flash?.("error", "Session invalid. Please login again.");
        return res.redirect("/login");
      }
      perf("tenant match", tenantCheckStartedAt);

      const userIdCheckStartedAt = Date.now();
      if (!payload.userId || !mongoose.Types.ObjectId.isValid(payload.userId)) {
        clearTenantCookies(req, res, tenantCode);
        if (wantsJson(req)) {
          return res.status(401).json({ message: "Unauthorized" });
        }
        req.flash?.("error", "Session invalid. Please login again.");
        return res.redirect("/login");
      }
      perf("user id check", userIdCheckStartedAt);

      const cacheStartedAt = Date.now();
      let user = getCachedUser(tenantCode, payload.userId);
      perf("user cache get", cacheStartedAt);

      if (!user) {
        const dbStartedAt = Date.now();
        user = await req.models.User.findOne({
          _id: payload.userId,
          deletedAt: null,
          status: "active",
        })
          .select("_id email roles status tokenVersion")
          .lean();
        perf("user db lookup", dbStartedAt);

        if (user) {
          setCachedUser(tenantCode, payload.userId, user);
        }
      }

      if (!user) {
        deleteCachedUser(tenantCode, payload.userId);
        clearTenantCookies(req, res, tenantCode);
        if (wantsJson(req)) {
          return res.status(401).json({ message: "Unauthorized" });
        }
        req.flash?.("error", "Your session expired. Please login again.");
        return res.redirect("/login");
      }

      const versionStartedAt = Date.now();
      const dbTokenVersion = Number(user.tokenVersion || 0);
      const jwtTokenVersion = Number(payload.tokenVersion || 0);

      if (dbTokenVersion !== jwtTokenVersion) {
        deleteCachedUser(tenantCode, payload.userId);
        clearTenantCookies(req, res, tenantCode);
        if (wantsJson(req)) {
          return res.status(401).json({ message: "Session expired" });
        }
        req.flash?.("warning", "Session expired. Please login again.");
        return res.redirect("/login");
      }
      perf("token version check", versionStartedAt);

      const roleStartedAt = Date.now();
      const roles = Array.isArray(user.roles) ? user.roles : [];
      const allowedRoles = Array.isArray(requiredRole)
        ? requiredRole
        : requiredRole
        ? [requiredRole]
        : [];

      if (allowedRoles.length && !allowedRoles.some((role) => roles.includes(role))) {
        if (wantsJson(req)) {
          return res.status(403).json({ message: "Forbidden" });
        }
        req.flash?.("error", "You don’t have permission to access that page.");
        return res.status(403).send("Forbidden");
      }
      perf("role check", roleStartedAt);

      req.user = {
        userId: String(user._id),
        email: user.email,
        roles,
        tenantCode,
      };

      perf("total", totalStartedAt);
      return next();
    } catch (e) {
      clearTenantCookies(req, res, tenantCode);
      if (wantsJson(req)) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      req.flash?.("error", "Please login again.");
      return res.redirect("/login");
    }
  };
};