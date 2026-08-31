// src/middleware/tenant/tenantResolver.js
const { platformConnection, getTenantConnection, boolEnv } = require("../../config/db");
const TenantFactory = require("../../models/platform/Tenant");
const SubscriptionFactory = require("../../models/platform/PlatformSubscription");
const loadTenantModels = require("../../models/tenant/loadModels");
const { isSubscriptionOperational } = require("../../services/platformSubscriptionService");
const {
  getAccessBundle,
  setAccessBundle,
} = require("../../services/platformTenantAccessCache");

const Tenant = TenantFactory(platformConnection);
const PlatformSubscription = SubscriptionFactory(platformConnection);

function getHost(req) {
  // Express only applies forwarded-host semantics according to the configured
  // trust-proxy chain. Avoid trusting X-Forwarded-Host directly here.
  return String(req.hostname || "").trim().toLowerCase();
}

function isPlatformHost(host, baseDomain) {
  return host === "admin.localhost" || (baseDomain && host === `admin.${baseDomain}`);
}

function isPublicHost(host, baseDomain) {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    (baseDomain && host === baseDomain) ||
    (baseDomain && host === `www.${baseDomain}`)
  );
}

function extractSubdomain(host, baseDomain) {
  if (host.endsWith(".localhost")) return host.replace(".localhost", "");
  if (baseDomain && host.endsWith(`.${baseDomain}`)) return host.replace(`.${baseDomain}`, "");
  return null;
}

function getModelsForConn(conn) {
  return loadTenantModels(conn);
}

function isPublicProfileRead(req) {
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  return /^\/schools(?:\/|$)/.test(String(req.path || req.url || ""));
}

function perf(label, startedAt) {
  if (process.env.DEBUG_PERF === "1") {
    console.log(`[tenantResolver] ${label}: ${Date.now() - startedAt}ms`);
  }
}

function wantsJson(req) {
  const accept = String(req.headers.accept || "");
  return accept.includes("application/json") || req.xhr;
}

function isMongoSrvTimeout(err) {
  return (
    err &&
    err.code === "ETIMEOUT" &&
    String(err.syscall || "").toLowerCase().includes("querysrv")
  );
}

async function loadTenantWithSubscription(match) {
  const rows = await Tenant.aggregate([
    { $match: { ...match, isDeleted: { $ne: true } } },
    { $limit: 1 },
    {
      $lookup: {
        from: PlatformSubscription.collection.name,
        let: { tenantId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$tenantId", "$$tenantId"] }, isDeleted: { $ne: true } } },
          { $sort: { updatedAt: -1 } },
          { $limit: 1 },
        ],
        as: "__platformSubscription",
      },
    },
    { $set: { __platformSubscription: { $first: "$__platformSubscription" } } },
  ]);

  const row = rows[0];
  if (!row) return null;
  const subscription = row.__platformSubscription || null;
  delete row.__platformSubscription;
  return { tenant: row, subscription };
}

module.exports = async function tenantResolver(req, res, next) {
  const totalStartedAt = Date.now();

  try {
    const hostStartedAt = Date.now();
    const host = getHost(req);
    const baseDomain = (process.env.BASE_DOMAIN || "").toLowerCase();
    const isProd = process.env.NODE_ENV === "production";
    const allowLocalhostTenants = boolEnv("ALLOW_LOCALHOST_TENANTS", false);
    const isLocalTenantHost = host.endsWith(".localhost");
    perf("host parsing", hostStartedAt);

    if (isProd && isLocalTenantHost && !allowLocalhostTenants) {
      return res
        .status(400)
        .send(`Invalid host for production: ${host}. Set ALLOW_LOCALHOST_TENANTS=true for local testing.`);
    }

    if (isPlatformHost(host, baseDomain)) {
      req.isPlatform = true;
      req.tenant = null;
      req.tenantConnection = null;
      req.models = null;
      perf("total", totalStartedAt);
      return next();
    }

    if (isPublicHost(host, baseDomain)) {
      req.isPlatform = false;
      req.tenant = null;
      req.tenantConnection = null;
      req.models = null;
      perf("total", totalStartedAt);
      return next();
    }

    let lookupKey = host;
    let lookupKind = "host";
    let match;
    let notFoundMessage;

    if (isLocalTenantHost || (baseDomain && host.endsWith(`.${baseDomain}`))) {
      const subdomain = extractSubdomain(host, baseDomain);
      if (!subdomain) return res.status(404).send(`Unknown host: ${host}`);
      lookupKey = subdomain;
      lookupKind = "sub";
      match = { $or: [{ code: subdomain }, { subdomain: host }, { subdomain }] };
      notFoundMessage = `Tenant '${subdomain}' not found`;
    } else {
      match = { customDomain: host };
      notFoundMessage = `Tenant for host '${host}' not found`;
    }

    const cacheStartedAt = Date.now();
    let resolved = await getAccessBundle(lookupKind, lookupKey);
    perf("redis route cache", cacheStartedAt);

    if (!resolved) {
      const dbLookupStartedAt = Date.now();
      resolved = await loadTenantWithSubscription(match);
      perf("tenant+subscription aggregate", dbLookupStartedAt);
      if (resolved) void setAccessBundle(lookupKind, lookupKey, resolved.tenant, resolved.subscription);
    }

    if (!resolved?.tenant) return res.status(404).send(notFoundMessage);

    const tenant = resolved.tenant;
    const subscription = resolved.subscription || null;

    if (!subscription && isProd) {
      return res.status(503).send("Tenant subscription is not provisioned.");
    }
    if (subscription?.migrationQuarantined) {
      return res.status(403).send("Tenant subscription requires platform review.");
    }

    const legacyTrialExpired =
      !subscription &&
      tenant.status === "trial" &&
      tenant.trialEndsAt &&
      new Date(tenant.trialEndsAt) <= new Date();

    const operational = subscription
      ? isSubscriptionOperational(subscription)
      : ["trial", "active"].includes(String(tenant.status || "").toLowerCase()) && !legacyTrialExpired;

    if (!operational) return res.status(403).send("This school subscription is not active.");

    req.platformSubscription = subscription;

    if (isPublicProfileRead(req)) {
      req.isPlatform = false;
      req.tenant = tenant;
      req.tenantConnection = null;
      req.models = null;
      perf("public profile fast path", totalStartedAt);
      return next();
    }

    if (!tenant.dbName) return res.status(500).send("Tenant missing dbName");

    const connStartedAt = Date.now();
    const tenantConn = await getTenantConnection(tenant.dbName);
    perf("get tenant connection", connStartedAt);

    const modelsStartedAt = Date.now();
    req.isPlatform = false;
    req.tenant = tenant;
    req.tenantConnection = tenantConn;
    req.models = getModelsForConn(tenantConn);
    perf("load tenant models", modelsStartedAt);
    perf("total", totalStartedAt);
    return next();
  } catch (e) {
    console.error("tenantResolver error:", e);

    if (isMongoSrvTimeout(e)) {
      const message = "Tenant database is temporarily unavailable. Please try again.";
      if (wantsJson(req)) return res.status(503).json({ message });
      return res.status(503).render(
        "platform/public/500",
        { message },
        (renderErr, html) => {
          if (renderErr) return res.status(503).send(message);
          return res.send(html);
        },
      );
    }
    return next(e);
  }
};

module.exports.loadTenantWithSubscription = loadTenantWithSubscription;
