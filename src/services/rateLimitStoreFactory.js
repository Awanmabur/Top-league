const { getRedisClient } = require('../config/redis');
const { RedisRateLimitStore } = require('./redisRateLimitStore');

function redisRateLimitOptions(prefix) {
  const redisClient = getRedisClient("rate");
  const useRedis = Boolean(redisClient) && (process.env.NODE_ENV === "production" || process.env.USE_REDIS_RATE_LIMITS === "1");
  return useRedis
    ? { store: new RedisRateLimitStore({ redisClient, prefix: `classic-academy:rl:${prefix}:` }) }
    : {};
}

module.exports = { redisRateLimitOptions };
