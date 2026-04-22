// src/middleware/tenant/tenantResolver.js
const { platformConnection, getTenantConnection, boolEnv } = require("../../config/db");
const TenantFactory = require("../../models/platform/Tenant");
const loadTenantModels = require("../../models/tenant/loadModels");

const Tenant = TenantFactory(platformConnection);

function getHost(req) {
  const raw = req.headers["x-forwarded-host"] || req.headers.host || "";
  return raw.split(",")[0].trim().split(":")[0].toLowerCase();
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

const TENANT_LOOKUP_CACHE = new Map();
const TENANT_TTL_MS = 5 * 60 * 1000;

function cacheGet(key) {
  const hit = TENANT_LOOKUP_CACHE.get(key);
  if (!hit) return null;

  if (Date.now() > hit.exp) {
    TENANT_LOOKUP_CACHE.delete(key);
    return null;
  }

  return hit.tenant;
}

function cacheSet(key, tenant) {
  TENANT_LOOKUP_CACHE.set(key, {
    tenant,
    exp: Date.now() + TENANT_TTL_MS,
  });
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

    let tenant = null;

    if (isLocalTenantHost || (baseDomain && host.endsWith(`.${baseDomain}`))) {
      const subdomain = extractSubdomain(host, baseDomain);

      if (!subdomain) {
        return res.status(404).send(`Unknown host: ${host}`);
      }

      const cacheStartedAt = Date.now();
      tenant = cacheGet(subdomain);
      perf("lookup cache get", cacheStartedAt);

      if (!tenant) {
        const dbLookupStartedAt = Date.now();
        tenant = await Tenant.findOne({
          $or: [{ code: subdomain }, { subdomain: host }, { subdomain: subdomain }],
          isDeleted: { $ne: true },
        }).lean();
        perf("tenant db lookup", dbLookupStartedAt);

        if (tenant) {
          cacheSet(subdomain, tenant);
        }
      }

      if (!tenant) {
        return res.status(404).send(`Tenant '${subdomain}' not found`);
      }
    } else {
      const cacheStartedAt = Date.now();
      tenant = cacheGet(host);
      perf("custom-domain cache get", cacheStartedAt);

      if (!tenant) {
        const dbLookupStartedAt = Date.now();
        tenant = await Tenant.findOne({
          customDomain: host,
          isDeleted: { $ne: true },
        }).lean();
        perf("custom-domain db lookup", dbLookupStartedAt);

        if (tenant) {
          cacheSet(host, tenant);
        }
      }

      if (!tenant) {
        return res.status(404).send(`Tenant for host '${host}' not found`);
      }
    }

    if (isPublicProfileRead(req)) {
      req.isPlatform = false;
      req.tenant = tenant;
      req.tenantConnection = null;
      req.models = null;
      perf("public profile fast path", totalStartedAt);
      return next();
    }

    if (!tenant.dbName) {
      return res.status(500).send("Tenant missing dbName");
    }

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
    return next(e);
  }
};
