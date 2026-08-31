function ttlSecondsForSession(session, fallbackSeconds) {
  const maxAge = Number(session?.cookie?.maxAge);
  if (Number.isFinite(maxAge) && maxAge > 0) return Math.max(1, Math.ceil(maxAge / 1000));
  return Math.max(1, Number(fallbackSeconds) || 86400);
}

function boundedTouchIntervalSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 300;
  return Math.min(3600, Math.max(30, Math.floor(parsed)));
}

function createRedisSessionStore({
  redisClient,
  prefix = "classic-academy:sess:",
  fallbackTtlSeconds = 604800,
  touchIntervalSeconds = boundedTouchIntervalSeconds(process.env.REDIS_SESSION_TOUCH_INTERVAL_SECONDS),
}) {
  if (!redisClient) throw new Error("redisClient is required");
  const session = require("express-session");
  const touchedAt = new Map();
  const touchWindowMs = boundedTouchIntervalSeconds(touchIntervalSeconds) * 1000;

  function noteTouch(sid) {
    touchedAt.set(sid, Date.now());
    if (touchedAt.size > 10000) {
      const cutoff = Date.now() - touchWindowMs;
      for (const [key, at] of touchedAt) {
        if (at < cutoff) touchedAt.delete(key);
        if (touchedAt.size <= 8000) break;
      }
    }
  }

  class RedisSessionStore extends session.Store {
    get(sid, callback) {
      redisClient.get(prefix + sid)
        .then((raw) => callback(null, raw ? JSON.parse(raw) : null))
        .catch((err) => callback(err));
    }

    set(sid, value, callback = () => {}) {
      redisClient.setEx(prefix + sid, ttlSecondsForSession(value, fallbackTtlSeconds), JSON.stringify(value))
        .then(() => {
          noteTouch(sid);
          callback(null);
        })
        .catch((err) => callback(err));
    }

    touch(sid, value, callback = () => {}) {
      const now = Date.now();
      const previous = Number(touchedAt.get(sid) || 0);
      if (previous && now - previous < touchWindowMs) {
        return queueMicrotask(() => callback(null));
      }

      const ttl = ttlSecondsForSession(value, fallbackTtlSeconds);
      redisClient.command("EXPIRE", prefix + sid, ttl)
        .then(() => {
          noteTouch(sid);
          callback(null);
        })
        .catch((err) => callback(err));
    }

    destroy(sid, callback = () => {}) {
      touchedAt.delete(sid);
      redisClient.del(prefix + sid)
        .then(() => callback(null))
        .catch((err) => callback(err));
    }
  }

  return new RedisSessionStore();
}

module.exports = {
  ttlSecondsForSession,
  boundedTouchIntervalSeconds,
  createRedisSessionStore,
};
