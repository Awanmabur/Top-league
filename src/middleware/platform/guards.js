const { platformConnection } = require("../../config/db");
const PlatformUser = require("../../models/platform/PlatformUser")(platformConnection);
const {
  getPlatformAccess,
  getPlatformDashboardRedirect,
  normalizePlatformRole,
  platformCan,
} = require("../../utils/platformAccess");

const PLATFORM_USER_CACHE = new Map();
const PLATFORM_USER_CACHE_TTL_MS = 30 * 1000;

function wantsJson(req) {
  const accept = String(req.headers.accept || "");
  return accept.includes("application/json") || req.xhr;
}

function getCachedPlatformUser(userId) {
  const key = String(userId || "");
  if (!key) return null;

  const hit = PLATFORM_USER_CACHE.get(key);
  if (!hit) return null;

  if (Date.now() > hit.exp) {
    PLATFORM_USER_CACHE.delete(key);
    return null;
  }

  return hit.user;
}

function setCachedPlatformUser(user) {
  const key = String(user?._id || "");
  if (!key) return;

  PLATFORM_USER_CACHE.set(key, {
    user,
    exp: Date.now() + PLATFORM_USER_CACHE_TTL_MS,
  });
}

function deleteCachedPlatformUser(userId) {
  const key = String(userId || "");
  if (!key) return;
  PLATFORM_USER_CACHE.delete(key);
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
  };
}

function attachPlatformUser(req, res, user) {
  const platformUser = buildPlatformUser(user);
  const access = getPlatformAccess(platformUser.role);

  if (req.session) {
    req.session.platformUserId = platformUser.id;
    req.session.platformRole = platformUser.role;
    req.session.platformEmail = platformUser.email;
    req.session.platformName = platformUser.name;
    req.session.platformTokenVersion = platformUser.tokenVersion;
  }

  req.user = platformUser;
  req.platformAccess = access;
  res.locals.user = platformUser;
  res.locals.platformUser = platformUser;
  res.locals.platformAccess = access;
  res.locals.currentPath = req.originalUrl || req.path || "";
}

function clearPlatformSession(req, res) {
  return new Promise((resolve) => {
    const userId = req.session?.platformUserId;
    if (userId) deleteCachedPlatformUser(userId);

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

  const cachedUser = getCachedPlatformUser(userId);
  if (cachedUser) return cachedUser;

  const user = await PlatformUser.findOne({
    _id: userId,
    isDeleted: { $ne: true },
    isActive: true,
  })
    .select("_id firstName lastName name email role tokenVersion isActive isDeleted")
    .lean();

  if (!user) return null;

  setCachedPlatformUser(user);
  return user;
}

function rejectUnauthorized(req, res) {
  if (wantsJson(req)) return res.status(401).json({ message: "Unauthorized" });
  return res.redirect("/login");
}

function rejectForbidden(req, res) {
  if (wantsJson(req)) return res.status(403).json({ message: "Forbidden" });
  return res.redirect(getPlatformDashboardRedirect(req.user?.role));
}

function withPlatformUser(req, res, next, onReady) {
  if (!req.session?.platformUserId) return rejectUnauthorized(req, res);

  loadPlatformUser(req)
    .then(async (user) => {
      if (!user) {
        await clearPlatformSession(req, res);
        return rejectUnauthorized(req, res);
      }

      const sessionTokenVersion = Number(
        req.session?.platformTokenVersion ?? user.tokenVersion ?? 0,
      );
      const currentTokenVersion = Number(user.tokenVersion || 0);

      if (sessionTokenVersion !== currentTokenVersion) {
        deleteCachedPlatformUser(user._id);
        await clearPlatformSession(req, res);
        return rejectUnauthorized(req, res);
      }

      attachPlatformUser(req, res, user);
      return onReady();
    })
    .catch(next);
}

function platformOnly(req, res, next) {
  return withPlatformUser(req, res, next, () => next());
}

function platformAdminOnly(req, res, next) {
  return withPlatformUser(req, res, next, () => {
    if (req.user.role !== "SuperAdmin") {
      return rejectForbidden(req, res);
    }

    return next();
  });
}

function platformRequire(permission) {
  return function (req, res, next) {
    return withPlatformUser(req, res, next, () => {
      if (platformCan(req.user.role, permission)) {
        return next();
      }

      return rejectForbidden(req, res);
    });
  };
}

module.exports = {
  platformOnly,
  platformAdminOnly,
  platformRequire,
};
