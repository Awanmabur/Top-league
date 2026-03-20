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

module.exports = async function resolveTenantAccess(req, res, next) {
  try {
    if (req.tenantAccess) return next();

    const explicitTenantCode =
      String(req.tenantCode || req.params?.tenantCode || "").trim().toLowerCase();

    const { host } = getHostParts(req);
    const hostTenantCode = extractTenantCodeFromHost(host);

    const tenantCode = explicitTenantCode || hostTenantCode;

    const tenant = await Tenant.findOne({
      isDeleted: { $ne: true },
      $or: [
        ...(tenantCode ? [{ code: tenantCode }, { subdomain: tenantCode }] : []),
        ...(host ? [{ customDomain: host }, { subdomain: host }] : []),
      ],
    })
      .populate("planId")
      .lean();

    if (!tenant) {
      return res.status(404).render("tenant/errors/tenant-not-found", {
        error: "Tenant not found.",
      });
    }

    if (!tenant.planId) {
      return res.status(500).render("tenant/errors/tenant-not-found", {
        error: "Tenant plan is not assigned.",
      });
    }

    const access = buildTenantAccess({
      tenant: {
        ...tenant,
        settings: {
          ...(tenant.settings || {}),
          modules: getTenantModulesFromPlan(tenant.planId),
        },
      },
      plan: tenant.planId,
    });

    req.tenant = tenant;
    req.tenantPlan = tenant.planId;
    req.tenantAccess = access;
    res.locals.tenant = tenant;
    res.locals.tenantPlan = tenant.planId;
    res.locals.tenantAccess = access;

    return next();
  } catch (err) {
    console.error("❌ resolveTenantAccess error:", err);
    return res.status(500).render("tenant/errors/tenant-not-found", {
      error: "Failed to resolve tenant access.",
    });
  }
};