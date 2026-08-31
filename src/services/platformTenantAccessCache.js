const crypto = require('crypto');
const { getRedisClient } = require('../config/redis');

const PREFIX = 'classic-academy:tenant-access:v2:';

function cacheCommandTimeoutMs() {
  const configured = Number(process.env.REDIS_CACHE_COMMAND_TIMEOUT_MS || 200);
  if (!Number.isFinite(configured)) return 200;
  return Math.max(50, Math.min(1000, Math.floor(configured)));
}

function ttlSeconds() {
  const configured = Number(process.env.TENANT_ACCESS_CACHE_TTL_SECONDS || 30);
  if (!Number.isFinite(configured)) return 30;
  return Math.max(5, Math.min(120, Math.floor(configured)));
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value || '').trim().toLowerCase()).digest('hex');
}

function keyForLookup(kind, value) {
  return `${PREFIX}${kind}:${digest(value)}`;
}

function tenantLookupKeys(tenant = {}) {
  const keys = new Set();
  const code = String(tenant.code || '').trim().toLowerCase();
  if (code) keys.add(keyForLookup('sub', code));
  const subdomain = String(tenant.subdomain || '').trim().toLowerCase();
  if (subdomain) {
    keys.add(keyForLookup('sub', subdomain));
    const baseDomain = String(process.env.BASE_DOMAIN || '').trim().toLowerCase();
    if (baseDomain && subdomain.endsWith(`.${baseDomain}`)) {
      keys.add(keyForLookup('sub', subdomain.slice(0, -(baseDomain.length + 1))));
    }
  }
  const customDomain = String(tenant.customDomain || '').trim().toLowerCase();
  if (customDomain) keys.add(keyForLookup('host', customDomain));
  return [...keys];
}

function serializeBundle(tenant, subscription) {
  return JSON.stringify({ tenant, subscription, cachedAt: Date.now() });
}

async function getAccessBundle(kind, lookup) {
  const client = getRedisClient();
  if (!client || !client.isReady?.()) return null;
  const key = keyForLookup(kind, lookup);
  try {
    const raw = await client.get(key, { timeoutMs: cacheCommandTimeoutMs() });
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.tenant) return null;
    return parsed;
  } catch (err) {
    console.error('Tenant access cache read failed:', err?.message || err);
    return null;
  }
}

async function setAccessBundle(kind, lookup, tenant, subscription) {
  const client = getRedisClient();
  if (!client || !client.isReady?.() || !tenant) return false;
  const payload = serializeBundle(tenant, subscription || null);
  const keys = new Set([keyForLookup(kind, lookup), ...tenantLookupKeys(tenant)]);
  try {
    await Promise.all([...keys].map((key) => client.setEx(key, ttlSeconds(), payload, { timeoutMs: cacheCommandTimeoutMs() })));
    return true;
  } catch (err) {
    console.error('Tenant access cache write failed:', err?.message || err);
    return false;
  }
}

async function invalidateTenantAccess(tenant) {
  const client = getRedisClient();
  if (!client || !tenant) return 0;
  const keys = tenantLookupKeys(tenant);
  if (!keys.length) return 0;
  try {
    return Number(await client.del(...keys) || 0);
  } catch (err) {
    console.error('Tenant access cache invalidation failed:', err?.message || err);
    return 0;
  }
}

module.exports = {
  PREFIX,
  ttlSeconds,
  keyForLookup,
  tenantLookupKeys,
  getAccessBundle,
  setAccessBundle,
  invalidateTenantAccess,
};
