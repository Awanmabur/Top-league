const { platformConnection } = require("../../config/db");
const Tenant = require("../../models/platform/Tenant")(platformConnection);
const Plan = require("../../models/platform/Plan")(platformConnection);
const PlatformSubscription = require("../../models/platform/PlatformSubscription")(platformConnection);

const {
  buildTenantAccess,
  getTenantModulesFromPlan,
} = require("../../utils/tenantPlanAccess");
const {
  subscriptionEffectiveStatus,
  subscriptionPlanAsAccessPlan,
} = require("../../services/platformSubscriptionService");

function getHostParts(req) {
  const host = String(req.hostname || "").trim().toLowerCase();
  const parts = host.split(".").filter(Boolean);
  return { host, parts };
}

function shouldSkipHost(host) {
  const skipHosts = new Set(["localhost", "127.0.0.1"]);
  return skipHosts.has(host);
}

function extractTenantCodeFromHost(host) {
  const baseDomain = String(process.env.BASE_DOMAIN || "").trim().toLowerCase();

  if (!host || shouldSkipHost(host)) return "";

  if (baseDomain && host.endsWith(`.${baseDomain}`)) {
    return host.slice(0, -1 * `.${baseDomain}`.length);
  }

  return "";
}

async function loadTenantPlan(tenant) {
  if (tenant?.planId && typeof tenant.planId === "object" && tenant.planId.enabledModules) {
    return tenant.planId;
  }

  if (!tenant?.planId) return null;

  return Plan.findById(tenant.planId).lean();
}

async function loadCurrentSubscription(tenant) {
  if (!tenant?._id) return null;
  return PlatformSubscription.findOne({
    tenantId: tenant._id,
    isDeleted: { $ne: true },
  }).lean();
}

module.exports = async function resolveTenantAccess(req, res, next) {
  try {
    if (req.tenantAccess) return next();

    let tenant = req.tenant || null;

    const explicitTenantCode = String(
      req.tenantCode || req.params?.tenantCode || "",
    )
      .trim()
      .toLowerCase();

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
      }).lean();
    }

    if (!tenant) {
      return res.status(404).render("platform/public/404", {
        error: "Tenant not found.",
      });
    }

    const subscription = req.platformSubscription || await loadCurrentSubscription(tenant);
    let plan = subscriptionPlanAsAccessPlan(subscription);

    // Production fails closed once the platform-SaaS migration is deployed.
    // Development/test retains the legacy plan fallback so migration and
    // isolated compatibility tests can be run before a platform DB exists.
    if (!subscription) {
      if (process.env.NODE_ENV === "production") {
        return res.status(503).render("platform/public/500", {
          error: "Tenant subscription is not provisioned.",
        });
      }
      plan = await loadTenantPlan(tenant);
    }

    if (subscription?.migrationQuarantined) {
      return res.status(403).render("platform/public/404", {
        error: "Tenant subscription requires platform review.",
      });
    }

    if (!plan) {
      return res.status(500).render("platform/public/500", {
        error: "Tenant plan is not assigned.",
      });
    }

    const effectiveStatus = subscription ? subscriptionEffectiveStatus(subscription) : tenant.status;
    const tenantProjection = {
      ...tenant,
      status: effectiveStatus === "expired" || effectiveStatus === "past_due" ? "suspended" : effectiveStatus,
      trialEndsAt: subscription?.trialEndsAt || tenant.trialEndsAt || null,
      subscriptionStartsAt: subscription?.currentPeriodStart || tenant.subscriptionStartsAt || null,
      subscriptionEndsAt: subscription?.currentPeriodEnd || tenant.subscriptionEndsAt || null,
      subscriptionRevision: subscription?.revision || tenant.subscriptionRevision || 1,
    };

    const access = buildTenantAccess({
      tenant: {
        ...tenantProjection,
        settings: {
          ...(tenant.settings || {}),
          modules: getTenantModulesFromPlan(plan),
        },
      },
      plan,
      subscription,
    });

    req.tenant = tenantProjection;
    req.tenantPlan = plan;
    req.platformSubscription = subscription;
    req.tenantAccess = access;
    res.locals.tenant = tenantProjection;
    res.locals.tenantPlan = plan;
    res.locals.platformSubscription = subscription;
    res.locals.tenantAccess = access;

    return next();
  } catch (err) {
    console.error("resolveTenantAccess error:", err.message || err);
    return res.status(500).render("platform/public/500", {
      error: "Failed to resolve tenant access.",
    });
  }
};
