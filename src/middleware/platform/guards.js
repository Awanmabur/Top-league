const { platformConnection } = require("../../config/db");
const PlatformUser = require("../../models/platform/PlatformUser")(platformConnection);
const PlatformConfig = require("../../models/platform/PlatformConfig")(platformConnection);
const {
  getPlatformAccess,
  getPlatformDashboardRedirect,
  normalizePlatformRole,
  platformCan,
} = require("../../utils/platformAccess");
const { DEFAULT_CONFIG } = require("../../services/platformConfigService");
const {
  getPlatformUser: getCachedPlatformUser,
  setPlatformUser: setCachedPlatformUser,
  getPlatformSecurityConfig,
  setPlatformSecurityConfig,
} = require("../../services/platformGuardCache");

function wantsJson(req) {
  const accept = String(req.headers.accept || "");
  return accept.includes("application/json") || req.xhr;
}

function buildPlatformUser(user) {
  const role = normalizePlatformRole(user?.role);
  const firstName = String(user?.firstName || "").trim();
  const lastName = String(user?.lastName || "").trim();
  const fallbackName = String(user?.name || "").trim();

  return {
    _id: String(user?._id || ""),
    id: String(user?._id || ""),
    role,
    email: String(user?.email || "").trim().toLowerCase(),
    name: fallbackName || [firstName, lastName].filter(Boolean).join(" ").trim(),
    tokenVersion: Number(user?.tokenVersion || 0),
    revision: Number(user?.revision || 1),
  };
}

function attachPlatformUser(req, res, user) {
  const platformUser = buildPlatformUser(user);
  const access = getPlatformAccess(platformUser.role);

  if (req.session) {
    if (String(req.session.platformUserId || "") !== platformUser.id) req.session.platformUserId = platformUser.id;
    if (String(req.session.platformRole || "") !== platformUser.role) req.session.platformRole = platformUser.role;
    if (String(req.session.platformEmail || "") !== platformUser.email) req.session.platformEmail = platformUser.email;
    if (String(req.session.platformName || "") !== platformUser.name) req.session.platformName = platformUser.name;
    if (Number(req.session.platformTokenVersion ?? -1) !== platformUser.tokenVersion) {
      req.session.platformTokenVersion = platformUser.tokenVersion;
    }

    const now = Date.now();
    const lastPersisted = Number(req.session.platformLastActivityAt || 0);
    const activityWriteIntervalMs = Math.min(
      5 * 60 * 1000,
      Math.max(15 * 1000, Number(process.env.PLATFORM_ACTIVITY_WRITE_INTERVAL_MS || 60 * 1000)),
    );
    if (!lastPersisted || now - lastPersisted >= activityWriteIntervalMs) {
      req.session.platformLastActivityAt = now;
    }
  }

  req.user = platformUser;
  req.platformAccess = access;
  req._platformAuthorityLoaded = true;
  res.locals.user = platformUser;
  res.locals.platformUser = platformUser;
  res.locals.platformAccess = access;
  res.locals.currentPath = req.originalUrl || req.path || "";
}

function clearPlatformSession(req, res) {
  return new Promise((resolve) => {
    const finalize = () => {
      res.clearCookie("platform.sid", { path: "/" });
      resolve();
    };

    if (!req.session) return finalize();
    return req.session.destroy(() => finalize());
  });
}

async function loadPlatformUser(req) {
  const userId = String(req.session?.platformUserId || "");
  if (!userId) return null;

  const cached = await getCachedPlatformUser(userId).catch(() => null);
  if (cached) return cached;

  const user = await PlatformUser.findOne({
    _id: userId,
    isDeleted: { $ne: true },
    isActive: true,
  })
    .select("_id firstName lastName name email role tokenVersion revision isActive isDeleted")
    .lean();
  if (user) await setCachedPlatformUser(userId, user).catch(() => {});
  return user;
}

async function loadSessionTimeoutMs() {
  let config = await getPlatformSecurityConfig().catch(() => null);
  if (!config) {
    config = await PlatformConfig.findOne({ singletonKey: "platform" })
      .select("security.sessionTimeoutMinutes")
      .lean();
    if (config) await setPlatformSecurityConfig(config).catch(() => {});
  }
  const minutes = Number(config?.security?.sessionTimeoutMinutes || DEFAULT_CONFIG.security.sessionTimeoutMinutes);
  const bounded = Number.isFinite(minutes) ? Math.min(1440, Math.max(15, Math.floor(minutes))) : DEFAULT_CONFIG.security.sessionTimeoutMinutes;
  return bounded * 60 * 1000;
}

function rejectUnauthorized(req, res) {
  if (wantsJson(req)) return res.status(401).json({ message: "Unauthorized" });
  return res.redirect("/login");
}

function rejectForbidden(req, res) {
  if (wantsJson(req)) return res.status(403).json({ message: "Forbidden" });
  return res.redirect(getPlatformDashboardRedirect(req.user?.role));
}

async function withPlatformUser(req, res, next, onReady) {
  try {
    if (!req.session?.platformUserId) return rejectUnauthorized(req, res);

    const [user, timeoutMs] = await Promise.all([
      loadPlatformUser(req),
      loadSessionTimeoutMs(),
    ]);

    if (!user) {
      await clearPlatformSession(req, res);
      return rejectUnauthorized(req, res);
    }

    const lastActivityAt = Number(req.session?.platformLastActivityAt || 0);
    if (lastActivityAt > 0 && Date.now() - lastActivityAt > timeoutMs) {
      await clearPlatformSession(req, res);
      return rejectUnauthorized(req, res);
    }

    const sessionTokenVersion = Number(
      req.session?.platformTokenVersion ?? user.tokenVersion ?? 0,
    );
    const currentTokenVersion = Number(user.tokenVersion || 0);

    if (sessionTokenVersion !== currentTokenVersion) {
      await clearPlatformSession(req, res);
      return rejectUnauthorized(req, res);
    }

    attachPlatformUser(req, res, user);
    return onReady();
  } catch (err) {
    return next(err);
  }
}

function platformOnly(req, res, next) {
  return withPlatformUser(req, res, next, () => next());
}

function platformAdminOnly(req, res, next) {
  const authorize = () => {
    if (req.user.role !== "SuperAdmin") {
      return rejectForbidden(req, res);
    }
    return next();
  };

  // Platform routes are commonly protected first by platformOnly and then by a
  // route-specific permission guard. Reuse the authority loaded earlier in the
  // same request instead of performing a second Redis/Mongo/session-timeout
  // lookup. Only this private request marker can enable reuse; request/user
  // input alone cannot bypass live authority validation.
  if (req._platformAuthorityLoaded && req.user && req.platformAccess) return authorize();
  return withPlatformUser(req, res, next, authorize);
}

function platformRequire(permission) {
  return function (req, res, next) {
    const authorize = () => {
      if (platformCan(req.user.role, permission)) {
        return next();
      }
      return rejectForbidden(req, res);
    };

    if (req._platformAuthorityLoaded && req.user && req.platformAccess) return authorize();
    return withPlatformUser(req, res, next, authorize);
  };
}

module.exports = {
  platformOnly,
  platformAdminOnly,
  platformRequire,
  clearPlatformSession,
};
