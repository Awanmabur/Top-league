const { getRedisClient } = require("../config/redis");

const FEATURED_KEY = "classic-academy:public:featured:v3";

function ttlSeconds() {
  const configured = Number(process.env.PUBLIC_DIRECTORY_CACHE_TTL_SECONDS || 30);
  if (!Number.isFinite(configured)) return 30;
  return Math.min(Math.max(Math.floor(configured), 5), 120);
}


function cacheCommandTimeoutMs() {
  const configured = Number(process.env.REDIS_CACHE_COMMAND_TIMEOUT_MS || 200);
  if (!Number.isFinite(configured)) return 200;
  return Math.max(50, Math.min(1000, Math.floor(configured)));
}

async function getFeaturedSchoolsCache() {
  const client = getRedisClient();
  if (!client || !client.isReady?.()) return null;
  try {
    const raw = await client.get(FEATURED_KEY, { timeoutMs: cacheCommandTimeoutMs() });
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    console.error("Public school cache read failed:", err?.message || err);
    return null;
  }
}

async function setFeaturedSchoolsCache(items) {
  const client = getRedisClient();
  if (!client || !client.isReady?.() || !Array.isArray(items)) return false;
  try {
    await client.setEx(FEATURED_KEY, ttlSeconds(), JSON.stringify(items), { timeoutMs: cacheCommandTimeoutMs() });
    return true;
  } catch (err) {
    console.error("Public school cache write failed:", err?.message || err);
    return false;
  }
}

async function invalidatePublicSchoolCache() {
  const client = getRedisClient();
  if (!client) return 0;
  try {
    return Number(await client.del(FEATURED_KEY) || 0);
  } catch (err) {
    console.error("Public school cache invalidation failed:", err?.message || err);
    return 0;
  }
}

module.exports = {
  FEATURED_KEY,
  getFeaturedSchoolsCache,
  setFeaturedSchoolsCache,
  invalidatePublicSchoolCache,
};
