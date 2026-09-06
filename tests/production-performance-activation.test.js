const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const { parseReply, encodeCommand, parseRedisUrl, RedisClient } = require('../src/config/redis');
const net = require('node:net');
const { RedisRateLimitStore } = require('../src/services/redisRateLimitStore');
const { ttlSecondsForSession } = require('../src/services/redisSessionStore');
const accessCache = require('../src/services/platformTenantAccessCache');
const readiness = require('../src/config/productionReadiness');
const subscriptionService = require('../src/services/platformSubscriptionService');

test('RESP parser handles incomplete and nested replies', () => {
  assert.equal(parseReply(Buffer.from('+PO')), null);
  const nested = parseReply(Buffer.from('*4\r\n+PONG\r\n:2\r\n$3\r\nfoo\r\n*2\r\n+OK\r\n:7\r\n'));
  assert.deepEqual(nested.value, ['PONG', 2, 'foo', ['OK', 7]]);
});

test('RESP command encoder uses byte lengths and array framing', () => {
  const encoded = encodeCommand(['SET', 'κ', 'value']).toString('utf8');
  assert.match(encoded, /^\*3\r\n\$3\r\nSET\r\n/);
  assert.match(encoded, /\$2\r\nκ\r\n/);
  assert.match(encoded, /\$5\r\nvalue\r\n$/);
});

test('Redis URL parser supports TLS, auth and database selection while rejecting non-Redis protocols', () => {
  assert.deepEqual(parseRedisUrl('rediss://default:p%40ss@redis.example.com:6380/2'), {
    secure: true, host: 'redis.example.com', port: 6380, username: 'default', password: 'p@ss', database: 2,
  });
  assert.throws(() => parseRedisUrl('https://redis.example.com'), /redis:\/\/ or rediss:\/\//);
});

test('Redis client completes a real TCP PING and basic cache command exchange', async () => {
  const server = net.createServer((socket) => {
    socket.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      if (text.includes('PING\r\n')) socket.write('+PONG\r\n');
      else if (text.includes('SETEX\r\n')) socket.write('+OK\r\n');
      else if (text.includes('GET\r\n')) socket.write('$5\r\nvalue\r\n');
      else if (text.includes('DEL\r\n')) socket.write(':1\r\n');
      else socket.write('-ERR unsupported\r\n');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const client = new RedisClient(`redis://127.0.0.1:${address.port}/0`, { connectTimeoutMs: 1000 });
  try {
    await client.connect();
    assert.equal(client.isReady(), true);
    assert.equal(await client.setEx('k', 10, 'value'), 'OK');
    assert.equal(await client.get('k'), 'value');
    assert.equal(await client.del('k'), 1);
  } finally {
    await client.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Redis command timeout fails fast and drops the socket so late replies cannot desynchronize RESP ordering', async () => {
  const server = net.createServer((socket) => {
    socket.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      if (text.includes('PING\r\n')) socket.write('+PONG\r\n');
      // Intentionally do not answer GET.
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const client = new RedisClient(`redis://127.0.0.1:${address.port}/0`, { connectTimeoutMs: 1000, commandTimeoutMs: 250 });
  try {
    await client.connect();
    await assert.rejects(client.get('slow'), (err) => err?.code === 'REDIS_COMMAND_TIMEOUT');
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(client.isReady(), false);
  } finally {
    await client.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('manual activation validator enforces reason, future end and five-year bound', () => {
  const now = new Date('2026-08-30T12:00:00Z');
  const valid = subscriptionService.validateManualActivationInput({ reason: 'Legacy school approved', periodEnd: '2027-08-30T12:00:00Z' }, now);
  assert.equal(valid.reason, 'Legacy school approved');
  assert.equal(valid.periodStart.toISOString(), now.toISOString());
  assert.equal(valid.periodEnd.toISOString(), '2027-08-30T12:00:00.000Z');
  assert.throws(() => subscriptionService.validateManualActivationInput({ reason: 'short', periodEnd: '2027-08-30T12:00:00Z' }, now), /at least 8/);
  assert.throws(() => subscriptionService.validateManualActivationInput({ reason: 'Valid reason', periodEnd: '2026-08-30T11:00:00Z' }, now), /future period end/);
  assert.throws(() => subscriptionService.validateManualActivationInput({ reason: 'Valid reason', periodEnd: '2032-08-30T12:00:00Z' }, now), /five years/);
});

test('Redis rate-limit store returns distributed hit count and reset time from atomic script result', async () => {
  const calls = [];
  const fake = { command: async (...args) => { calls.push(args); return [4, 1500]; }, del: async () => 1 };
  const store = new RedisRateLimitStore({ redisClient: fake, prefix: 'x:' });
  store.init({ windowMs: 60000 });
  const before = Date.now();
  const result = await store.increment('ip');
  assert.equal(result.totalHits, 4);
  assert.ok(result.resetTime.getTime() >= before + 1400);
  assert.equal(calls[0][0], 'EVAL');
  assert.equal(calls[0][3], 'x:ip');
});

test('Redis session TTL honors cookie maxAge and safe fallback', () => {
  assert.equal(ttlSecondsForSession({ cookie: { maxAge: 1501 } }, 99), 2);
  assert.equal(ttlSecondsForSession({ cookie: {} }, 99), 99);
});

test('tenant access cache keys are hashed and include all routable tenant aliases', () => {
  const keys = accessCache.tenantLookupKeys({ code: 'ABC', subdomain: 'abc.example.com', customDomain: 'school.example.org' });
  assert.ok(keys.length >= 3);
  assert.ok(keys.every((key) => key.startsWith('classic-academy:tenant-access:v2:')));
  assert.ok(keys.every((key) => !key.includes('school.example.org')));
});

test('production readiness requires Redis and accepts rediss URLs', () => {
  const src = read('src/config/productionReadiness.js');
  assert.match(src, /check\('REDIS_URL', isRedisUrl/);
  assert.equal(readiness.isRedisUrl('rediss://default:secret@redis.example.com:6380/0'), true);
  assert.equal(readiness.isRedisUrl('mongodb://localhost/redis'), false);
});

test('production application uses distinct Redis stores for platform and tenant sessions and pings Redis before listen', () => {
  const src = read('src/index.js');
  assert.match(src, /classic-academy:session:platform:/);
  assert.match(src, /classic-academy:session:tenant:/);
  assert.match(src, /const redisStartup = connectRedis\(\)\.catch/);
  assert.match(src, /if \(isProd\) throw err/);
  assert.match(src, /Promise\.all\(\[waitForPlatform\(\), redisStartup\]\)/);
  assert.match(src, /closeRedis\(\)/);
  assert.match(src, /redisClient\?\.isReady/);
});

test('abuse-sensitive tenant auth inquiry review and booking limits use shared Redis while broad shaping stays local', () => {
  const index = read('src/index.js');
  assert.match(index, /app\.use\(\s*rateLimit\(\{/);
  assert.doesNotMatch(index, /classic-academy:rl:global/);
  const tenant = read('src/middleware/tenant/rateLimiters.js');
  assert.match(tenant, /redisRateLimitOptions/);
  for (const marker of ['public-inquiry','public-review','tenant-auth']) assert.ok(tenant.includes(marker));
  const booking = read('src/controllers/platform/bookingController.js');
  assert.match(booking, /redisRateLimitOptions/);
  for (const marker of ['booking-api','booking-submit']) assert.ok(booking.includes(marker));
});

test('tenant resolver checks shared access cache before Platform Mongo and stores tenant plus subscription bundle', () => {
  const src = read('src/middleware/tenant/tenantResolver.js');
  const cacheAt = src.indexOf('getAccessBundle(lookupKind, lookupKey)');
  const tenantDbAt = src.indexOf('loadTenantWithSubscription(match)', cacheAt);
  assert.ok(cacheAt >= 0 && tenantDbAt > cacheAt);
  assert.match(src, /setAccessBundle\(lookupKind, lookupKey, resolved\.tenant, resolved\.subscription\)/);
  assert.match(src, /\$lookup:[\s\S]{0,500}PlatformSubscription\.collection\.name/);
});

test('tenant status, edits, billing, expiry and deletion invalidate shared tenant access cache', () => {
  const tenants = read('src/controllers/platform/tenantsController.js');
  assert.match(tenants, /invalidateTenantCache\(tenantBefore, tenantAfter\)/);
  assert.match(tenants, /invalidateTenantCache\(tenantInvalidation, tenantAfterStatus\)/);
  assert.match(tenants, /invalidateTenantCache\(deletedTenantCache\)/);
  assert.match(read('src/controllers/platform/billingController.js'), /invalidateTenantAccess\(tenant\)/);
  assert.match(read('src/services/platformSubscriptionScheduler.js'), /invalidateTenantAccess\(changedTenant\)/);
});

test('manual activation is billing-gated and requires revisions, reason and explicit future period end', () => {
  const routes = read('src/routes/platform/tenants.js');
  assert.match(routes, /schools\/:id\/manual-activate", platformRequire\("billing\.manage"\)/);
  const src = read('src/controllers/platform/tenantsController.js');
  const block = src.slice(src.indexOf('manualActivateTenant: async'), src.indexOf('resendTenantInvite: async'));
  assert.match(block, /positiveRevision\(req\.body\.revision\)/);
  assert.match(block, /positiveRevision\(req\.body\.subscriptionRevision\)/);
  assert.match(block, /validateManualActivationInput/);
  assert.match(block, /manual_activation_override/);
  assert.match(block, /migrationQuarantined: false/);
  assert.doesNotMatch(block, /PlatformPayment/);
});

test('manual activation projects a real active period to Tenant so public-directory operational filter can include school', () => {
  const src = read('src/controllers/platform/tenantsController.js');
  const block = src.slice(src.indexOf('manualActivateTenant: async'), src.indexOf('resendTenantInvite: async'));
  assert.match(block, /tenantProjectionFromSubscription\(projectedSubscription\)/);
  assert.match(block, /status: "active"/);
  assert.match(block, /currentPeriodEnd: periodEnd/);
  const directory = read('src/services/platformPublicDirectoryService.js');
  assert.match(directory, /status: "active", subscriptionEndsAt: \{ \$gt: current \}/);
});

test('school detail UI exposes manual activation and explains public-directory eligibility without inline handlers', () => {
  const view = read('views/platform/tenants/show.ejs');
  assert.match(view, /Manual Activate/);
  assert.match(view, /name="periodEnd"/);
  assert.match(view, /name="reason"/);
  assert.match(view, /Public Directory/);
  assert.doesNotMatch(view, /\son(?:click|change|submit)=/i);
});

test('platform guards cache user and session-timeout reads in Redis', () => {
  const guards = read('src/middleware/platform/guards.js');
  assert.match(guards, /getCachedPlatformUser/);
  assert.match(guards, /setCachedPlatformUser/);
  assert.match(guards, /getPlatformSecurityConfig/);
  assert.match(guards, /setPlatformSecurityConfig/);
});

test('platform user/security mutations invalidate guard caches to preserve immediate revocation semantics', () => {
  const auth = read('src/controllers/platform/authController.js');
  assert.ok((auth.match(/invalidatePlatformUser\(/g) || []).length >= 3);
  const settings = read('src/controllers/platform/settingsController.js');
  assert.match(settings, /invalidatePlatformSecurityConfig/);
  assert.match(settings, /invalidatePlatformUser\(row\._id\)/);
});

test('Redis implementation adds no npm dependency and therefore preserves dependency-lock strategy', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.dependencies.redis, undefined);
  assert.equal(pkg.dependencies['connect-redis'], undefined);
  assert.equal(pkg.dependencies['rate-limit-redis'], undefined);
});

test('platform tenant show view still compiles after activation controls', () => {
  const ejs = require('ejs');
  assert.doesNotThrow(() => ejs.compile(read('views/platform/tenants/show.ejs'), { filename: path.join(root, 'views/platform/tenants/show.ejs') }));
});

test('production runbook documents mandatory Redis and audited migrated-school activation', () => {
  const doc = read('docs/PRODUCTION_RELEASE_CANDIDATE.md');
  assert.match(doc, /Redis is mandatory in production/);
  assert.match(doc, /REDIS_URL/);
  assert.match(doc, /Manual Activate/);
  assert.match(doc, /manual_activation_override/);
});

test('public landing featured schools use shared Redis cache instead of disabled process-local cache', () => {
  const src = read('src/controllers/platform/schoolsPublicController.js');
  const block = src.slice(src.indexOf('async function loadFeaturedSchoolsForLanding'), src.indexOf('async function findTenantForPublicPage'));
  assert.match(block, /getFeaturedSchoolsCache\(\)/);
  assert.match(block, /setFeaturedSchoolsCache\(items\)/);
  assert.doesNotMatch(src, /FEATURED_SCHOOLS_CACHE_MS|featuredSchoolsCache\s*=\s*\{/);
  const cache = read('src/services/platformPublicCacheService.js');
  assert.match(cache, /classic-academy:public:featured:v3/);
  assert.match(cache, /PUBLIC_DIRECTORY_CACHE_TTL_SECONDS/);
});

test('public profile reconciliation calls canonical projection once and invalidates shared marketing cache', () => {
  const src = read('src/controllers/tenant/admin/profileController.js');
  const start = src.indexOf('async function reconcilePublicPresenceBestEffort');
  const end = src.indexOf('async function saveProfileWithRevision', start);
  const block = src.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(block, /syncPublicProjection\(tenantDoc, models\)/);
  assert.match(block, /invalidatePublicSchoolCache\(\)/);
  assert.doesNotMatch(block, /await reconcilePublicPresenceBestEffort\(tenantDoc, models\)/);
});

test('school lifecycle, billing and expiry invalidate both access and public featured-school caches', () => {
  const tenants = read('src/controllers/platform/tenantsController.js');
  assert.match(tenants, /invalidatePublicSchoolCache\(\)/);
  const billing = read('src/controllers/platform/billingController.js');
  assert.match(billing, /invalidateTenantAccess\(tenant\)/);
  assert.match(billing, /invalidatePublicSchoolCache\(\)/);
  const scheduler = read('src/services/platformSubscriptionScheduler.js');
  assert.match(scheduler, /invalidateTenantAccess\(changedTenant\)/);
  assert.match(scheduler, /invalidatePublicSchoolCache\(\)/);
});
