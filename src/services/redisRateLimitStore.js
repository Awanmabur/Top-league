const FIXED_WINDOW_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {current, ttl}
`;

class RedisRateLimitStore {
  constructor({ redisClient, prefix = 'classic-academy:rl:' }) {
    if (!redisClient) throw new Error('redisClient is required');
    this.redisClient = redisClient;
    this.prefix = prefix;
    this.windowMs = 60000;
  }

  init(options) {
    this.windowMs = Number(options?.windowMs || this.windowMs);
  }

  async increment(key) {
    const redisKey = this.prefix + key;
    const result = await this.redisClient.command('EVAL', FIXED_WINDOW_SCRIPT, 1, redisKey, this.windowMs);
    const totalHits = Number(Array.isArray(result) ? result[0] : 0) || 0;
    const ttlMs = Math.max(0, Number(Array.isArray(result) ? result[1] : this.windowMs) || this.windowMs);
    return { totalHits, resetTime: new Date(Date.now() + ttlMs) };
  }

  async decrement(key) {
    const redisKey = this.prefix + key;
    await this.redisClient.command('EVAL', "local v=redis.call('GET',KEYS[1]); if not v then return 0 end; v=tonumber(v); if v<=1 then redis.call('DEL',KEYS[1]); return 0 end; return redis.call('DECR',KEYS[1])", 1, redisKey);
  }

  async resetKey(key) {
    await this.redisClient.del(this.prefix + key);
  }
}

module.exports = { RedisRateLimitStore, FIXED_WINDOW_SCRIPT };
