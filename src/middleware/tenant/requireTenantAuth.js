const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { getPrimaryTenantRole, normalizeTenantRoles, STAFF_PORTAL_ROLES } = require("../../utils/tenantRoles");
const { normalizePermissionList } = require("../../services/tenant/roleService");
const { getTenantCookieOptions } = require("../../config/runtime");
const { isTenantOperational } = require("../../utils/tenantPlanAccess");

function getBearerToken(req) {
  const h = req.headers["authorization"];
  if (!h) return null;
  const [type, token] = h.split(" ");
  return type?.toLowerCase() === "bearer" ? token : null;
}

function wantsJson(req) {
  const accept = String(req.headers.accept || "");
  // Offline-queue replays (public/js/offline/queue.js) fetch() with default
  // redirect handling, so a redirect-to-login on an expired/invalid session
  // would otherwise be silently followed and read back as a 200 "success",
  // permanently discarding the queued submission. Forcing JSON here lets the
  // queue see the real 401 and keep the item for the user to retry after
  // logging back in.
  return accept.includes("application/json") || req.xhr || req.headers["x-offline-replay"] === "1";
}

function safeLower(s) {
  return String(s || "").trim().toLowerCase();
}

function cookieOptions(req) {
  return getTenantCookieOptions(req);
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

    if (req.tenantAccess && !isTenantOperational(req.tenantAccess)) {
      const message = "This school subscription is not active.";
      if (wantsJson(req)) return res.status(403).json({ message });
      req.flash?.("error", message);
      return res.status(403).send("Tenant access inactive");
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
          .select("_id email firstName lastName roles status tokenVersion staffId studentId")
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
      const roles = normalizeTenantRoles(user.roles);
      const primaryRole = getPrimaryTenantRole(roles);
      const allowedRoles = Array.isArray(requiredRole)
        ? requiredRole
        : requiredRole
        ? [requiredRole]
        : [];

      if (allowedRoles.length && !allowedRoles.includes(primaryRole)) {
        if (wantsJson(req)) {
          return res.status(403).json({ message: "Forbidden" });
        }
        req.flash?.("error", "You don't have permission to access that page.");
        return res.status(403).send("Forbidden");
      }
      perf("role check", roleStartedAt);

      if (
        Array.isArray(user.roles) &&
        (user.roles.length !== roles.length || user.roles.some((role, index) => role !== roles[index]))
      ) {
        req.models.User.updateOne(
          { _id: user._id, deletedAt: null },
          { $set: { roles } },
        ).catch(() => {});

        user = {
          ...user,
          roles,
        };
        setCachedUser(tenantCode, payload.userId, user);
      }

      if (primaryRole === "student" && req.models?.Student) {
        if (!user.studentId) {
          deleteCachedUser(tenantCode, payload.userId);
          clearTenantCookies(req, res, tenantCode);
          if (wantsJson(req)) return res.status(403).json({ message: "Student record unavailable" });
          req.flash?.("error", "Your student record is not linked to this account.");
          return res.status(403).send("Forbidden");
        }
        const studentRecord = await req.models.Student.findOne({
          _id: user.studentId,
          userId: user._id,
          isDeleted: { $ne: true },
          status: { $nin: ["suspended", "archived"] },
        }).select("_id status").lean();
        if (!studentRecord) {
          deleteCachedUser(tenantCode, payload.userId);
          clearTenantCookies(req, res, tenantCode);
          if (wantsJson(req)) return res.status(403).json({ message: "Student access disabled" });
          req.flash?.("error", "Your student access is currently disabled.");
          return res.status(403).send("Forbidden");
        }
      }

      if (primaryRole === "parent") {
        if (!req.models?.Parent) {
          deleteCachedUser(tenantCode, payload.userId);
          clearTenantCookies(req, res, tenantCode);
          if (wantsJson(req)) return res.status(403).json({ message: "Parent record unavailable" });
          req.flash?.("error", "Your parent record is not available.");
          return res.status(403).send("Forbidden");
        }
        const parentRecord = await req.models.Parent.findOne({
          userId: user._id,
          isDeleted: { $ne: true },
          status: { $in: ["active", "on_hold"] },
        }).select("_id status").lean();
        if (!parentRecord) {
          deleteCachedUser(tenantCode, payload.userId);
          clearTenantCookies(req, res, tenantCode);
          if (wantsJson(req)) return res.status(403).json({ message: "Parent access disabled" });
          req.flash?.("error", "Your parent access is currently disabled.");
          return res.status(403).send("Forbidden");
        }
      }

      let staffAccess = null;
      if (STAFF_PORTAL_ROLES.includes(primaryRole)) {
        if (!user.staffId || !req.models?.Staff) {
          deleteCachedUser(tenantCode, payload.userId);
          clearTenantCookies(req, res, tenantCode);
          if (wantsJson(req)) return res.status(403).json({ message: "Staff record unavailable" });
          req.flash?.("error", "Your staff record is not linked to this account.");
          return res.status(403).send("Forbidden");
        }
        const staffRecord = await req.models.Staff.findOne({
          _id: user.staffId,
          userId: user._id,
          isDeleted: { $ne: true },
        })
          .select("_id status roleId")
          .lean();

        if (!staffRecord || ["Suspended", "Exited"].includes(String(staffRecord.status || ""))) {
          if (wantsJson(req)) return res.status(403).json({ message: "Staff access disabled" });
          req.flash?.("error", "Your staff access is currently disabled.");
          return res.status(403).send("Forbidden");
        }

        if (staffRecord.roleId && req.models?.StaffRole) {
          const accessRole = await req.models.StaffRole.findOne({
            _id: staffRecord.roleId,
            isDeleted: { $ne: true },
          })
            .select("_id name code status permissions")
            .lean();

          staffAccess = {
            roleId: String(staffRecord.roleId),
            roleName: accessRole?.name || "",
            roleCode: accessRole?.code || "",
            active: !!accessRole && accessRole.status === "Active",
            permissions: accessRole && accessRole.status === "Active"
              ? normalizePermissionList(accessRole.permissions)
              : [],
          };
        }
      }

      req.user = {
        userId: String(user._id),
        _id: String(user._id),
        id: String(user._id),
        email: user.email,
        roles,
        role: primaryRole,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        name: [user.firstName, user.lastName].filter(Boolean).join(" ").trim(),
        tenantCode,
        staffId: user.staffId ? String(user.staffId) : null,
        accessRoleId: staffAccess?.roleId || null,
        accessRoleName: staffAccess?.roleName || "",
        accessRoleCode: staffAccess?.roleCode || "",
        accessRoleActive: staffAccess ? staffAccess.active : null,
        accessPermissions: staffAccess ? staffAccess.permissions : null,
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

// Security-sensitive user/status changes should invalidate the short-lived
// authentication cache immediately rather than waiting for TTL expiry.
module.exports.invalidateTenantUserCache = deleteCachedUser;
