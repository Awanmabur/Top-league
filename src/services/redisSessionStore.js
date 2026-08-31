function ttlSecondsForSession(session, fallbackSeconds) {
  const maxAge = Number(session?.cookie?.maxAge);
  if (Number.isFinite(maxAge) && maxAge > 0) return Math.max(1, Math.ceil(maxAge / 1000));
  return Math.max(1, Number(fallbackSeconds) || 86400);
}

function createRedisSessionStore({ redisClient, prefix = 'classic-academy:sess:', fallbackTtlSeconds = 604800 }) {
  if (!redisClient) throw new Error('redisClient is required');
  const session = require('express-session');
  class RedisSessionStore extends session.Store {
    get(sid, callback) {
      redisClient.get(prefix + sid)
        .then((raw) => callback(null, raw ? JSON.parse(raw) : null))
        .catch((err) => callback(err));
    }
    set(sid, value, callback = () => {}) {
      redisClient.setEx(prefix + sid, ttlSecondsForSession(value, fallbackTtlSeconds), JSON.stringify(value))
        .then(() => callback(null))
        .catch((err) => callback(err));
    }
    touch(sid, value, callback = () => {}) {
      const ttl = ttlSecondsForSession(value, fallbackTtlSeconds);
      redisClient.command('EXPIRE', prefix + sid, ttl)
        .then(() => callback(null))
        .catch((err) => callback(err));
    }
    destroy(sid, callback = () => {}) {
      redisClient.del(prefix + sid)
        .then(() => callback(null))
        .catch((err) => callback(err));
    }
  }
  return new RedisSessionStore();
}

module.exports = { ttlSecondsForSession, createRedisSessionStore };
