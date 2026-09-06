const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const { ensureCollectionIndex } = require('../scripts/lib/indexReconciler');

test('Admissions dashboard computes totals and status KPIs in one aggregation instead of four count round-trips', () => {
  const controller = read('src/controllers/tenant/admin/admissionsController.js');
  const start = controller.indexOf('async function getApplicantListing');
  const end = controller.indexOf('module.exports = {', start);
  const block = controller.slice(start, end);
  assert.match(block, /const summaryPromise = Applicant\.aggregate\(\[/);
  assert.match(block, /pending: \{ \$sum:/);
  assert.match(block, /accepted: \{ \$sum:/);
  assert.match(block, /rejected: \{ \$sum:/);
  assert.doesNotMatch(block, /Applicant\.countDocuments\(/);
});

test('Admissions pipeline quick view uses the actual pipeline column stage', () => {
  const view = read('views/tenant/admissions/index.ejs');
  const start = view.indexOf('<!-- PIPELINE -->');
  const block = view.slice(start, view.indexOf('<!--', start + 20) > start ? view.indexOf('<!--', start + 20) : undefined);
  assert.match(view.slice(start), /data-status="<%= safe\(st\.key\) %>"/);
  assert.doesNotMatch(view.slice(start), /data-status="<%= safe\(stage\) %>"/);
});

test('specialized tenant unique indexes are not duplicated by field-level index declarations', () => {
  const cases = [
    ['src/models/tenant/Program.js', 'legacySubjectId'],
    ['src/models/tenant/Scholarship.js', 'sourceApplicationId'],
    ['src/models/tenant/Student.js', 'userId'],
    ['src/models/tenant/Staff.js', 'userId'],
    ['src/models/tenant/LibraryBook.js', 'bookId'],
    ['src/models/tenant/LibraryFine.js', 'loan'],
    ['src/models/tenant/Hostel.js', 'roomId'],
    ['src/models/tenant/AssetMaintenance.js', 'sourceEmbeddedId'],
    ['src/models/tenant/Classroom.js', 'roomKey'],
    ['src/models/tenant/TransportAssignment.js', 'student'],
  ];
  for (const [file, field] of cases) {
    const src = read(file);
    const pathPattern = new RegExp(`${field.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*:\\s*\\{[^}]{0,220}index\\s*:\\s*true`);
    assert.doesNotMatch(src, pathPattern, `${file} still duplicates ${field}`);
  }
});

test('SystemHealth partial unique index uses Mongo-supported equality and migration normalizes isDeleted', () => {
  const model = read('src/models/tenant/SystemHealth.js');
  const migration = read('scripts/lib/migrateAuditHealth.js');
  assert.match(model, /uniq_active_system_health_service/);
  assert.match(model, /partialFilterExpression:\s*\{\s*isDeleted:\s*false,\s*migrationQuarantinedAt:\s*null/);
  assert.doesNotMatch(model, /partialFilterExpression:[^\n]*\$ne/);
  assert.match(migration, /isDeleted:r\.isDeleted===true/);
});

test('index reconciler replaces stale same-key index only after uniqueness preflight', async () => {
  const calls = [];
  const collection = {
    indexes: async () => [{ name: '_id_', key: { _id: 1 } }, { name: 'userId_1', key: { userId: 1 } }],
    aggregate: () => ({ toArray: async () => [] }),
    dropIndex: async (name) => { calls.push(['drop', name]); },
    createIndex: async (fields, options) => { calls.push(['create', fields, options]); return options.name; },
  };
  const result = await ensureCollectionIndex(collection, { userId: 1 }, {
    name: 'uniq_active_student_user', unique: true,
    partialFilterExpression: { isDeleted: false, userId: { $type: 'objectId' } },
  });
  assert.equal(result.status, 'replaced');
  assert.deepEqual(calls[0], ['drop', 'userId_1']);
  assert.equal(calls[1][0], 'create');
});

test('index reconciler never drops an old index when duplicate data would make the new unique index unsafe', async () => {
  const calls = [];
  const collection = {
    indexes: async () => [{ name: 'student_1', key: { student: 1 } }],
    aggregate: () => ({ toArray: async () => [{ _id: { student: 'dup' }, count: 2 }] }),
    dropIndex: async (name) => { calls.push(['drop', name]); },
    createIndex: async () => { calls.push(['create']); },
  };
  await assert.rejects(
    ensureCollectionIndex(collection, { student: 1 }, { name: 'uniq_active_transport_assignment_student', unique: true, partialFilterExpression: { status: 'active', isDeleted: false } }),
    (err) => err?.code === 'INDEX_DUPLICATES_PRESENT',
  );
  assert.deepEqual(calls, []);
});

test('development request state avoids unstable Redis while production sessions and abuse limits remain Redis-backed', () => {
  const index = read('src/index.js');
  const factory = read('src/services/rateLimitStoreFactory.js');
  const redis = read('src/config/redis.js');
  assert.match(index, /useRedisSessions = Boolean\(redisClient\) && \(isProd \|\| process\.env\.USE_REDIS_SESSIONS === "1"\)/);
  assert.doesNotMatch(index, /useRedisRateLimits\s*=/);
  assert.match(index, /High-risk auth\/booking\/inquiry\/review limiters stay/);
  assert.match(factory, /process\.env\.NODE_ENV === "production" \|\| process\.env\.USE_REDIS_RATE_LIMITS === "1"/);
  assert.match(redis, /if \(String\(env\.NODE_ENV \|\| ""\).*=== "production"\) return true/);
  assert.match(redis, /env\.USE_REDIS_SESSIONS/);
  assert.match(redis, /env\.USE_REDIS_RATE_LIMITS/);
  assert.match(redis, /env\.USE_REDIS_CACHE/);
  assert.match(redis, /roles = \["session", "rate", "cache"\]\.filter\(\(role\) => isRedisRoleEnabled\(role\)\)/);
  assert.match(index, /disabled in development/);
  assert.match(index, /degraded \(\$\{readyRoles\.length\}\/\$\{enabledRoles\.length\} roles connected\)/);
});

test('tenant cache misses do not wait for best-effort Redis population and reads skip unhealthy Redis', () => {
  const resolver = read('src/middleware/tenant/tenantResolver.js');
  const cache = read('src/services/platformTenantAccessCache.js');
  assert.match(resolver, /void setAccessBundle\(lookupKind, lookupKey, resolved\.tenant, resolved\.subscription\)/);
  assert.match(cache, /if \(!client \|\| !client\.isReady\?\.\(\)\) return null/);
});

test('Redis client schedules bounded background reconnects after socket closure', () => {
  const redis = read('src/config/redis.js');
  assert.match(redis, /_scheduleReconnect\(\)/);
  assert.match(redis, /reconnectMaxDelayMs/);
  assert.match(redis, /this\._scheduleReconnect\(\);/);
  assert.match(redis, /message === lastMessage && now - lastLoggedAt < 5000/);
});


test('Redis roles are off by default in development and mandatory in production', () => {
  const { isRedisRoleEnabled } = require('../src/config/redis');
  const base = { REDIS_URL: 'rediss://example.test:6380/0', NODE_ENV: 'development' };
  assert.equal(isRedisRoleEnabled('session', base), false);
  assert.equal(isRedisRoleEnabled('rate', base), false);
  assert.equal(isRedisRoleEnabled('cache', base), false);
  assert.equal(isRedisRoleEnabled('session', { ...base, USE_REDIS_SESSIONS: '1' }), true);
  assert.equal(isRedisRoleEnabled('rate', { ...base, USE_REDIS_RATE_LIMITS: '1' }), true);
  assert.equal(isRedisRoleEnabled('cache', { ...base, USE_REDIS_CACHE: '1' }), true);
  assert.equal(isRedisRoleEnabled('session', { ...base, NODE_ENV: 'production' }), true);
  assert.equal(isRedisRoleEnabled('rate', { ...base, NODE_ENV: 'production' }), true);
  assert.equal(isRedisRoleEnabled('cache', { ...base, NODE_ENV: 'production' }), true);
  assert.equal(isRedisRoleEnabled('cache', { NODE_ENV: 'production' }), false);
});


test('development Redis bootstrap performs no network work unless a role is explicitly enabled', async () => {
  const redisModule = require('../src/config/redis');
  const keys = ['REDIS_URL','NODE_ENV','USE_REDIS_SESSIONS','USE_REDIS_RATE_LIMITS','USE_REDIS_CACHE'];
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.REDIS_URL = 'redis://127.0.0.1:1/0';
    process.env.NODE_ENV = 'development';
    delete process.env.USE_REDIS_SESSIONS;
    delete process.env.USE_REDIS_RATE_LIMITS;
    delete process.env.USE_REDIS_CACHE;
    redisModule.resetRedisClientForTests();
    assert.equal(await redisModule.connectRedis(), null);
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    redisModule.resetRedisClientForTests();
  }
});

test('cache services cannot reconnect Redis when the cache role is disabled', () => {
  for (const file of [
    'src/services/platformGuardCache.js',
    'src/services/platformPublicCacheService.js',
    'src/services/platformTenantAccessCache.js',
  ]) {
    const src = read(file);
    assert.match(src, /isRedisRoleEnabled\("cache"\) \? getRedisClient\("cache"\) : null/);
    assert.doesNotMatch(src, /const client = getRedisClient\("cache"\)/);
  }
});

test('Redis heartbeat is bounded and cleaned up on close', () => {
  const redis = read('src/config/redis.js');
  assert.match(redis, /REDIS_HEARTBEAT_INTERVAL_MS \|\| 30000/);
  assert.match(redis, /this\._startHeartbeat\(\)/);
  assert.match(redis, /this\._stopHeartbeat\(\)/);
  assert.match(redis, /if \(!this\.isReady\(\) \|\| this\.pending\.length\) return/);
});

test('production readiness compatibility command is packaged', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['check:production-readiness'], 'node scripts/release-readiness.js');
});

test('dashboard launches detail analytics before waiting for KPI batch', () => {
  const src = read('src/controllers/tenant/admin/dashboardController.js');
  const details = src.indexOf('const dashboardDetailsPromise = Promise.all([');
  const kpiAwait = src.indexOf('] = await Promise.all([', details);
  const detailAwait = src.indexOf('] = await dashboardDetailsPromise;', kpiAwait);
  assert.ok(details >= 0 && kpiAwait > details && detailAwait > kpiAwait);
});

test('opt-in request telemetry reports genuinely slow HTTP requests without changing response flow', () => {
  const src = read('src/index.js');
  assert.match(src, /process\.env\.PERF_LOGS === "1"/);
  assert.match(src, /SLOW_REQUEST_MS/);
  assert.match(src, /\[slow-request\]/);
  assert.match(src, /res\.once\("finish"/);
});

test('student dashboard launches independent portal and academic reads concurrently', () => {
  const src = read('src/controllers/tenant/students/dashboardController.js');
  assert.match(src, /const financePromise = Invoice/);
  assert.match(src, /const attendancePromise = Attendance/);
  assert.match(src, /const portalAudienceContextPromise = \(Announcement \|\| Event\)/);
  assert.match(src, /const resultsPromise = Result/);
  assert.match(src, /const registrationsPromise = CourseRegistration/);
  assert.match(src, /const tasksPromise = Assignment/);
  assert.match(src, /\] = await Promise\.all\(\[/);
});

test('parent dashboard overlaps unread, announcements and linked-child loading', () => {
  const src = read('src/controllers/tenant/parents/dashboardController.js');
  const unread = src.indexOf('const unreadPromise =');
  const announcements = src.indexOf('const announcementsPromise =', unread);
  const children = src.indexOf('const childrenPromise =', announcements);
  const all = src.indexOf('await Promise.all([', children);
  assert.ok(unread >= 0 && announcements > unread && children > announcements && all > children);
});

test('staff dashboard overlaps unread, announcements, timetable, leave and payroll lookup', () => {
  const src = read('src/controllers/tenant/staff/dashboardController.js');
  assert.match(src, /const unreadPromise = Notification/);
  assert.match(src, /const announcementsPromise = Announcement/);
  assert.match(src, /const timetablePromise = \(staff && TimetableEntry\)/);
  assert.match(src, /const pendingLeavePromise = \(staff && LeaveRequest\)/);
  assert.match(src, /const payslipsPromise = \(staff && PayrollRun && PayrollItem\)/);
  assert.match(src, /\[unread, announcements, timetableCount, pendingLeave, payslips\] = await Promise\.all/);
});

test('request locals and admin dashboard preserve lazy tenant models instead of compiling every schema', () => {
  const locals = read('src/middleware/tenant/setLocals.js');
  const dashboard = read('src/controllers/tenant/admin/dashboardController.js');
  assert.match(locals, /const availableModels = Object\.keys\(req\.models \|\| \{\}\);/);
  assert.doesNotMatch(locals, /filter\(\(key\) => req\.models/);
  assert.match(dashboard, /new Set\(Object\.keys\(models\)\)/);
  assert.match(dashboard, /new Set\(Object\.keys\(req\.models \|\| \{\}\)\)/);
  assert.doesNotMatch(dashboard, /Object\.keys\([^\n]+\)\.filter\(\(key\) => (?:models|req\.models)/);
});

test('best-effort Redis caches have a short command budget while session commands keep the normal bounded timeout', () => {
  const redis = read('src/config/redis.js');
  const tenantCache = read('src/services/platformTenantAccessCache.js');
  const publicCache = read('src/services/platformPublicCacheService.js');
  const guardCache = read('src/services/platformGuardCache.js');
  assert.match(redis, /REDIS_COMMAND_TIMEOUT_MS \|\| 1000/);
  assert.match(redis, /timeoutMs = this\.commandTimeoutMs/);
  assert.match(redis, /get\(key, options\)/);
  assert.match(tenantCache, /REDIS_CACHE_COMMAND_TIMEOUT_MS \|\| 200/);
  assert.match(tenantCache, /client\.get\(key, \{ timeoutMs: cacheCommandTimeoutMs\(\) \}\)/);
  assert.match(publicCache, /client\.get\(FEATURED_KEY, \{ timeoutMs: cacheCommandTimeoutMs\(\) \}\)/);
  assert.match(guardCache, /client\.get\(key, \{ timeoutMs: cacheCommandTimeoutMs\(\) \}\)/);
});


test('index maintenance gets a longer cold-connect budget without relaxing live DB defaults', () => {
  const indexes = read('scripts/create-indexes.js');
  const db = read('src/config/db.js');
  assert.match(indexes, /MONGO_SERVER_SELECTION_TIMEOUT_MS\) process\.env\.MONGO_SERVER_SELECTION_TIMEOUT_MS = "30000"/);
  assert.match(indexes, /MONGO_CONNECT_TIMEOUT_MS\) process\.env\.MONGO_CONNECT_TIMEOUT_MS = "30000"/);
  assert.match(db, /boundedIntEnv\("MONGO_SERVER_SELECTION_TIMEOUT_MS", 10000/);
  assert.match(db, /boundedIntEnv\("MONGO_CONNECT_TIMEOUT_MS", 10000/);
});
