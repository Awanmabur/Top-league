const { getRedisClient, isRedisRoleEnabled } = require('../config/redis');

const USER_TTL_SECONDS = Math.max(3, Math.min(60, Number(process.env.PLATFORM_USER_CACHE_TTL_SECONDS || 15)));
const CONFIG_TTL_SECONDS = Math.max(5, Math.min(300, Number(process.env.PLATFORM_CONFIG_CACHE_TTL_SECONDS || 60)));

function userKey(id) { return `classic-academy:platform-user:v1:${String(id || '')}`; }
const configKey = 'classic-academy:platform-config:security:v1';

function cacheClient() {
  return isRedisRoleEnabled("cache") ? getRedisClient("cache") : null;
}


function cacheCommandTimeoutMs() {
  const configured = Number(process.env.REDIS_CACHE_COMMAND_TIMEOUT_MS || 200);
  if (!Number.isFinite(configured)) return 200;
  return Math.max(50, Math.min(1000, Math.floor(configured)));
}

async function getJson(key) {
  const client = cacheClient();
  if (!client || !client.isReady?.()) return null;
  const raw = await client.get(key, { timeoutMs: cacheCommandTimeoutMs() });
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch (_) { await client.del(key); return null; }
}

async function setJson(key, value, ttl) {
  const client = cacheClient();
  if (!client || !client.isReady?.()) return false;
  try {
    await client.setEx(key, ttl, JSON.stringify(value), { timeoutMs: cacheCommandTimeoutMs() });
    return true;
  } catch (_) {
    return false;
  }
}

function getPlatformUser(id) { return getJson(userKey(id)); }
function setPlatformUser(id, value) { return setJson(userKey(id), value, USER_TTL_SECONDS); }
async function invalidatePlatformUser(id) {
  const client = cacheClient();
  if (client && id) await client.del(userKey(id));
}

function getPlatformSecurityConfig() { return getJson(configKey); }
function setPlatformSecurityConfig(value) { return setJson(configKey, value, CONFIG_TTL_SECONDS); }
async function invalidatePlatformSecurityConfig() {
  const client = cacheClient();
  if (client) await client.del(configKey);
}

module.exports = {
  USER_TTL_SECONDS,
  CONFIG_TTL_SECONDS,
  getPlatformUser,
  setPlatformUser,
  invalidatePlatformUser,
  getPlatformSecurityConfig,
  setPlatformSecurityConfig,
  invalidatePlatformSecurityConfig,
};
