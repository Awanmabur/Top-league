const { platformConnection } = require("../../config/db");
const Tenant = require("../../models/platform/Tenant")(platformConnection);
const Plan = require("../../models/platform/Plan")(platformConnection);

const {
  buildTenantAccess,
  getTenantModulesFromPlan,
} = require("../../utils/tenantPlanAccess");

function getHostParts(req) {
  const forwarded = req.headers["x-forwarded-host"];
  const rawHost = forwarded || req.headers.host || "";
  const host = String(rawHost).split(",")[0].trim().split(":")[0].toLowerCase();
  const parts = host.split(".").filter(Boolean);
  return { host, parts };
}

function shouldSkipHost(host) {
  const skipHosts = new Set([
    "localhost",
    "127.0.0.1",
  ]);

  return skipHosts.has(host);
}

function extractTenantCodeFromHost(host) {
  const baseDomain = String(process.env.BASE_DOMAIN || "").trim().toLowerCase();

  if (!host || shouldSkipHost(host)) return "";

  if (baseDomain && host.endsWith(`.${baseDomain}`)) {
    return host.slice(0, -1 * (`.${baseDomain}`.length));
  }

  return "";
}

const ACCESS_CACHE = new Map();
const ACCESS_TTL_MS = 5 * 60 * 1000;

function accessCacheKey(tenant) {
  const tenantId = tenant?._id ? String(tenant._id) : "";
  const planId = tenant?.planId?._id ? String(tenant.planId._id) : String(tenant?.planId || "");
  const updatedAt = tenant?.updatedAt ? new Date(tenant.updatedAt).getTime() : "";
  return tenantId && planId ? `${tenantId}:${planId}:${updatedAt}` : "";
}

function getCachedAccess(tenant) {
  const key = accessCacheKey(tenant);
  if (!key) return null;

  const hit = ACCESS_CACHE.get(key);
  if (!hit) return null;

  if (Date.now() > hit.exp) {
    ACCESS_CACHE.delete(key);
    return null;
  }

  return hit.value;
}

function setCachedAccess(tenant, value) {
  const key = accessCacheKey(tenant);
  if (!key) return;
  ACCESS_CACHE.set(key, {
    value,
    exp: Date.now() + ACCESS_TTL_MS,
  });
}

async function loadTenantPlan(tenant) {
  if (tenant?.planId && typeof tenant.planId === "object" && tenant.planId.enabledModules) {
    return tenant.planId;
  }

  if (!tenant?.planId) return null;

  return Plan.findById(tenant.planId).lean();
}

module.exports = async function resolveTenantAccess(req, res, next) {
  try {
    if (req.tenantAccess) return next();

    let tenant = req.tenant || null;

    if (tenant) {
      const cached = getCachedAccess(tenant);
      if (cached) {
        req.tenantPlan = cached.plan;
        req.tenantAccess = cached.access;
        res.locals.tenant = cached.tenant;
        res.locals.tenantPlan = cached.plan;
        res.locals.tenantAccess = cached.access;
        return next();
      }
    }

    const explicitTenantCode =
      String(req.tenantCode || req.params?.tenantCode || "").trim().toLowerCase();

    if (!tenant) {
      const { host } = getHostParts(req);
      const hostTenantCode = extractTenantCodeFromHost(host);

      const tenantCode = explicitTenantCode || hostTenantCode;

      tenant = await Tenant.findOne({
        isDeleted: { $ne: true },
        $or: [
          ...(tenantCode ? [{ code: tenantCode }, { subdomain: tenantCode }] : []),
          ...(host ? [{ customDomain: host }, { subdomain: host }] : []),
        ],
      })
        .populate("planId")
        .lean();
    }

    if (!tenant) {
      return res.status(404).render("tenant/errors/tenant-not-found", {
        error: "Tenant not found.",
      });
    }

    const plan = await loadTenantPlan(tenant);

    if (!plan) {
      return res.status(500).render("tenant/errors/tenant-not-found", {
        error: "Tenant plan is not assigned.",
      });
    }

    const access = buildTenantAccess({
      tenant: {
        ...tenant,
        settings: {
          ...(tenant.settings || {}),
          modules: getTenantModulesFromPlan(plan),
        },
      },
      plan,
    });

    req.tenant = tenant;
    req.tenantPlan = plan;
    req.tenantAccess = access;
    res.locals.tenant = tenant;
    res.locals.tenantPlan = plan;
    res.locals.tenantAccess = access;
    setCachedAccess(tenant, { tenant, plan, access });

    return next();
  } catch (err) {
    console.error("resolveTenantAccess error:", err.message || err);
    return res.status(500).render("tenant/errors/tenant-not-found", {
      error: "Failed to resolve tenant access.",
    });
  }
};
