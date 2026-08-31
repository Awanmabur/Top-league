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

const AUTHORITY_CACHE = new Map();
const AUTHORITY_CACHE_TTL_MS = Math.max(
  1000,
  Math.min(30_000, Number(process.env.TENANT_AUTHORITY_CACHE_TTL_MS || 15_000)),
);

function authorityCacheKey(tenantCode, userId) {
  return `${tenantCode}:${userId}`;
}

function useLocalAuthorityCache() {
  // Production authorization is always live so a status/token/role revocation on
  // another app instance is visible immediately. Development may use a tiny
  // process-local cache for fast iteration; every lifecycle mutation invalidates it.
  return process.env.NODE_ENV !== "production" && process.env.DISABLE_TENANT_AUTH_CACHE !== "1";
}

function getCachedAuthority(tenantCode, userId) {
  if (!useLocalAuthorityCache()) return null;
  const key = authorityCacheKey(tenantCode, userId);
  const hit = AUTHORITY_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    AUTHORITY_CACHE.delete(key);
    return null;
  }
  return hit.authority;
}

function setCachedAuthority(tenantCode, userId, authority) {
  if (!useLocalAuthorityCache()) return;
  AUTHORITY_CACHE.set(authorityCacheKey(tenantCode, userId), {
    authority,
    exp: Date.now() + AUTHORITY_CACHE_TTL_MS,
  });
}

function deleteCachedUser(tenantCode, userId) {
  AUTHORITY_CACHE.delete(authorityCacheKey(safeLower(tenantCode), userId));
}

async function loadLiveAuthority(req, userId) {
  const User = req.models?.User;
  const Student = req.models?.Student;
  const Parent = req.models?.Parent;
  const Staff = req.models?.Staff;
  const StaffRole = req.models?.StaffRole;
  if (!User || !Student || !Parent || !Staff || !StaffRole) return null;

  const [authority] = await User.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(userId),
        deletedAt: null,
        status: "active",
      },
    },
    { $limit: 1 },
    {
      $lookup: {
        from: Student.collection.name,
        let: { studentId: "$studentId", userId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$_id", "$$studentId"] },
                  { $eq: ["$userId", "$$userId"] },
                  { $ne: ["$isDeleted", true] },
                  { $not: [{ $in: ["$status", ["suspended", "archived"]] }] },
                ],
              },
            },
          },
          { $project: { _id: 1, status: 1 } },
          { $limit: 1 },
        ],
        as: "_studentAuthority",
      },
    },
    {
      $lookup: {
        from: Parent.collection.name,
        let: { userId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$userId", "$$userId"] },
                  { $ne: ["$isDeleted", true] },
                  { $in: ["$status", ["active", "on_hold"]] },
                ],
              },
            },
          },
          { $project: { _id: 1, status: 1 } },
          { $limit: 1 },
        ],
        as: "_parentAuthority",
      },
    },
    {
      $lookup: {
        from: Staff.collection.name,
        let: { staffId: "$staffId", userId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$_id", "$$staffId"] },
                  { $eq: ["$userId", "$$userId"] },
                  { $ne: ["$isDeleted", true] },
                  { $not: [{ $in: ["$status", ["Suspended", "Exited"]] }] },
                ],
              },
            },
          },
          { $project: { _id: 1, status: 1, roleId: 1 } },
          { $limit: 1 },
        ],
        as: "_staffAuthority",
      },
    },
    { $set: { _staffAuthority: { $first: "$_staffAuthority" } } },
    {
      $lookup: {
        from: StaffRole.collection.name,
        let: { roleId: "$_staffAuthority.roleId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$_id", "$$roleId"] },
                  { $ne: ["$isDeleted", true] },
                ],
              },
            },
          },
          { $project: { _id: 1, name: 1, code: 1, status: 1, permissions: 1 } },
          { $limit: 1 },
        ],
        as: "_staffRoleAuthority",
      },
    },
    {
      $project: {
        _id: 1,
        email: 1,
        firstName: 1,
        lastName: 1,
        roles: 1,
        status: 1,
        tokenVersion: 1,
        staffId: 1,
        studentId: 1,
        studentAuthority: { $first: "$_studentAuthority" },
        parentAuthority: { $first: "$_parentAuthority" },
        staffAuthority: "$_staffAuthority",
        staffRoleAuthority: { $first: "$_staffRoleAuthority" },
      },
    },
  ]).option({ maxTimeMS: 3000 });

  return authority || null;
}

module.exports = function requireTenantAuth(requiredRole = null) {
  return async function (req, res, next) {
    const totalStartedAt = Date.now();

    // Nested tenant routers sometimes apply an additional role guard after the
    // parent Admin/Staff router already performed the full live authority
    // check. Reuse only within this same request; never cache StaffRole or
    // lifecycle authority across requests.
    if (req._tenantAuthorityLoaded && req.user) {
      const allowedRoles = Array.isArray(requiredRole)
        ? requiredRole
        : requiredRole
        ? [requiredRole]
        : [];
      if (allowedRoles.length && !allowedRoles.includes(req.user.role)) {
        if (wantsJson(req)) return res.status(403).json({ message: "Forbidden" });
        req.flash?.("error", "You don't have permission to access that page.");
        return res.status(403).send("Forbidden");
      }
      perf("same-request authority reuse", totalStartedAt);
      return next();
    }

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
      let authority = getCachedAuthority(tenantCode, payload.userId);
      perf("authority cache get", cacheStartedAt);

      if (!authority) {
        const dbStartedAt = Date.now();
        authority = await loadLiveAuthority(req, payload.userId);
        perf("live authority aggregate", dbStartedAt);
        if (authority) setCachedAuthority(tenantCode, payload.userId, authority);
      }

      const user = authority;
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

        user.roles = roles;
      }

      if (primaryRole === "student") {
        if (!user.studentId || !authority.studentAuthority) {
          deleteCachedUser(tenantCode, payload.userId);
          clearTenantCookies(req, res, tenantCode);
          if (wantsJson(req)) return res.status(403).json({ message: "Student access disabled" });
          req.flash?.("error", "Your student access is currently disabled.");
          return res.status(403).send("Forbidden");
        }
      }

      if (primaryRole === "parent" && !authority.parentAuthority) {
        deleteCachedUser(tenantCode, payload.userId);
        clearTenantCookies(req, res, tenantCode);
        if (wantsJson(req)) return res.status(403).json({ message: "Parent access disabled" });
        req.flash?.("error", "Your parent access is currently disabled.");
        return res.status(403).send("Forbidden");
      }

      let staffAccess = null;
      if (STAFF_PORTAL_ROLES.includes(primaryRole)) {
        const staffRecord = authority.staffAuthority;
        if (!user.staffId || !staffRecord) {
          deleteCachedUser(tenantCode, payload.userId);
          clearTenantCookies(req, res, tenantCode);
          if (wantsJson(req)) return res.status(403).json({ message: "Staff access disabled" });
          req.flash?.("error", "Your staff access is currently disabled.");
          return res.status(403).send("Forbidden");
        }

        const accessRole = authority.staffRoleAuthority;
        staffAccess = {
          roleId: staffRecord.roleId ? String(staffRecord.roleId) : null,
          roleName: accessRole?.name || "",
          roleCode: accessRole?.code || "",
          active: !!accessRole && accessRole.status === "Active",
          permissions: accessRole && accessRole.status === "Active"
            ? normalizePermissionList(accessRole.permissions)
            : [],
        };
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

      req._tenantAuthorityLoaded = true;
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
