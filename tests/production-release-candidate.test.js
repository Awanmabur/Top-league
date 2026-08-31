const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const readiness = require('../src/config/productionReadiness');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function validEnv() {
  return {
    PLATFORM_DB_URI: 'mongodb+srv://user:pass@example.mongodb.net/platform',
    MONGO_URI_BASE: 'mongodb+srv://user:pass@example.mongodb.net/tenant',
    REDIS_URL: 'rediss://default:secret@redis.example.com:6380/0',
    SESSION_SECRET: 's'.repeat(40), JWT_SECRET: 'j'.repeat(40), INVITE_TOKEN_SECRET: 'i'.repeat(40),
    TRANSCRIPT_SIGNING_SECRET: 't'.repeat(40), DOCUMENT_SIGNING_SECRET: 'd'.repeat(40),
    INTEGRATION_CREDENTIAL_ENCRYPTION_KEY: 'e'.repeat(40), PLATFORM_AUDIT_PRIVACY_SECRET: 'a'.repeat(40),
    PUBLIC_REVIEW_FINGERPRINT_SECRET: 'r'.repeat(40), TENANT_BACKUP_KEY: '11'.repeat(32),
    BASE_DOMAIN: 'classicacademy.example', PUBLIC_SITE_URL: 'https://classicacademy.example',
    PLATFORM_SITE_URL: 'https://admin.classicacademy.example', APP_PUBLIC_URL: 'https://classicacademy.example',
    SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'mailer@example.com', SMTP_PASS: 'secret', SMTP_FROM: 'mailer@example.com',
    CLOUDINARY_CLOUD_NAME: 'cloud', CLOUDINARY_API_KEY: 'key', CLOUDINARY_API_SECRET: 'secret',
    GOOGLE_OAUTH_CLIENT_ID: 'google-client', GOOGLE_OAUTH_CLIENT_SECRET: 'google-secret',
    GOOGLE_OAUTH_REDIRECT_URI: 'https://classicacademy.example/oauth/callback', GOOGLE_OAUTH_REFRESH_TOKEN: 'refresh',
    ZOOM_ACCOUNT_ID: 'zoom-account', ZOOM_CLIENT_ID: 'zoom-client', ZOOM_CLIENT_SECRET: 'zoom-secret',
  };
}

test('production readiness accepts a complete production contract on the pinned Node version', () => {
  const result = readiness.validateProductionReadiness(validEnv(), { nodeVersion: readiness.PINNED_NODE_VERSION });
  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('production readiness fails closed on runtime, backup-key, dedicated privacy secret and booking gaps', () => {
  const env = validEnv();
  delete env.PLATFORM_AUDIT_PRIVACY_SECRET;
  delete env.GOOGLE_OAUTH_REFRESH_TOKEN;
  env.TENANT_BACKUP_KEY = 'short';
  const result = readiness.validateProductionReadiness(env, { nodeVersion: '22.16.0' });
  assert.equal(result.ok, false);
  const joined = result.errors.join('\n');
  assert.match(joined, /Node 24\.11\.1 is required/);
  assert.match(joined, /TENANT_BACKUP_KEY/);
  assert.match(joined, /PLATFORM_AUDIT_PRIVACY_SECRET/);
  assert.match(joined, /GOOGLE_OAUTH_REFRESH_TOKEN/);
});

test('production readiness rejects insecure URLs, localhost base domains and unsafe debug flags', () => {
  const env = validEnv();
  env.PUBLIC_SITE_URL = 'http://classicacademy.example';
  env.BASE_DOMAIN = 'localhost';
  env.ALLOW_INSECURE_INTEGRATION_HTTP = '1';
  const result = readiness.validateProductionReadiness(env, { nodeVersion: readiness.PINNED_NODE_VERSION });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /PUBLIC_SITE_URL/);
  assert.match(result.errors.join('\n'), /BASE_DOMAIN/);
  assert.match(result.errors.join('\n'), /ALLOW_INSECURE_INTEGRATION_HTTP/);
});

test('production runtime calls the shared readiness assertion instead of maintaining a second secret checklist', () => {
  const src = read('src/config/runtime.js');
  assert.match(src, /assertProductionReadiness\(process\.env\)/);
  assert.doesNotMatch(src, /blockedDebugFlags/);
});

test('release readiness command is packaged and engine remains exactly pinned', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.engines.node, '24.11.1');
  assert.equal(pkg.scripts['release:readiness'], 'node scripts/release-readiness.js');
  const src = read('scripts/release-readiness.js');
  assert.match(src, /dependencyLockSha256/);
  assert.doesNotMatch(src, /console\.log\([^\n]*(PASS|SECRET|TOKEN|PASSWORD)[^\n]*process\.env/i);
});

test('index command runs migrations before platform and tenant index synchronization', () => {
  const src = read('scripts/create-indexes.js');
  assert.ok(src.indexOf('migratePlatformSaas(platformModels)') < src.indexOf('createModelIndexes("platform", platformModels)'));
  assert.ok(src.indexOf('migratePlatformOperations(platformModels)') < src.indexOf('createModelIndexes("platform", platformModels)'));
  assert.ok(src.indexOf('migrateHelpdeskTickets') < src.indexOf('createModelIndexes(label, tenantModels)'));
  assert.ok(src.indexOf('migrateStudentSelfService') < src.indexOf('createModelIndexes(label, tenantModels)'));
});

test('server starts all durable schedulers after platform DB readiness and stops them on graceful shutdown', () => {
  const src = read('src/index.js');
  const listenAt = src.indexOf('app.listen');
  for (const name of ['startAnnouncementScheduler','startMessageScheduler','startEventScheduler','startLeaveScheduler','startBackupScheduler','startPlatformSubscriptionScheduler']) {
    assert.ok(src.indexOf(`${name}();`, listenAt) > listenAt, name);
  }
  for (const name of ['stopAnnouncementScheduler','stopMessageScheduler','stopEventScheduler','stopLeaveScheduler','stopBackupScheduler','stopPlatformSubscriptionScheduler']) {
    assert.match(src, new RegExp(`${name}\\(\\);`));
  }
  assert.match(src, /SIGTERM/);
  assert.match(src, /SIGINT/);
});

test('production bootstrap asserts readiness before database configuration is loaded', () => {
  const src = read('src/index.js');
  const readinessAt = src.indexOf('productionReadiness').valueOf();
  const dbAt = src.indexOf('require("./config/db")');
  assert.ok(readinessAt >= 0 && dbAt > readinessAt, 'readiness must execute before DB module load');
});

test('liveness/readiness probes are tenant-independent, cache-disabled and reveal no connection details', () => {
  const src = read('src/index.js');
  const healthAt = src.indexOf('app.get("/healthz"');
  const readyAt = src.indexOf('app.get("/readyz"');
  const resolverAt = src.indexOf('app.use(tenantResolver)');
  assert.ok(healthAt > 0 && readyAt > healthAt && resolverAt > readyAt);
  assert.match(src.slice(healthAt, resolverAt), /Cache-Control", "no-store"/);
  assert.doesNotMatch(src.slice(healthAt, resolverAt), /dbName|PLATFORM_DB_URI|host:/);
});

test('production tenant host resolution uses shared Redis access cache with canonical subscription bundle', () => {
  const src = read('src/middleware/tenant/tenantResolver.js');
  assert.match(src, /getAccessBundle\(lookupKind, lookupKey\)/);
  assert.match(src, /loadTenantWithSubscription\(match\)/);
  assert.match(src, /setAccessBundle\(lookupKind, lookupKey, resolved\.tenant, resolved\.subscription\)/);
  assert.match(src, /getTenantConnection\(tenant\.dbName\)/);
  assert.match(src, /req\.models = getModelsForConn\(tenantConn\)/);
  assert.doesNotMatch(src, /TENANT_LOOKUP_CACHE\s*=\s*new Map/);
});

test('tenant connection cache is keyed only by resolved database name and never shares a model object across db names', () => {
  const src = read('src/config/db.js');
  assert.match(src, /TENANT_CACHE\.get\(dbName\)/);
  assert.match(src, /TENANT_CACHE\.set\(dbName, conn\)/);
  assert.match(src, /platformConnection\.useDb\(dbName, \{ useCache: true \}\)/);
  assert.match(src, /createConnection\(tenantBaseUri,[\s\S]{0,100}dbName/);
});

test('every standalone migration package script is represented in unified index synchronization', () => {
  const pkg = JSON.parse(read('package.json'));
  const indexSrc = read('scripts/create-indexes.js');
  const migrationScripts = Object.entries(pkg.scripts).filter(([name]) => name.startsWith('migrate:'));
  assert.ok(migrationScripts.length >= 40);
  for (const [, command] of migrationScripts) {
    const scriptPath = command.replace(/^node\s+/, '');
    const body = read(scriptPath);
    const libMatch = body.match(/require\(["']\.\/lib\/([^"']+)["']\)/);
    assert.ok(libMatch, `${scriptPath} must import a migration library`);
    assert.ok(indexSrc.includes(`./lib/${libMatch[1]}`), `${scriptPath} migration library missing from create-indexes.js`);
  }
});

test('restore rehearsal contract requires exact confirmation, checksum/decryption, tenant identity, pre-restore backup and transaction', () => {
  const service = read('src/services/tenant/backupService.js');
  const controller = read('src/controllers/tenant/admin/backupController.js');
  assert.match(service, /`RESTORE \$\{str\(name,220\)\}`/);
  assert.match(service, /Backup checksum verification failed/);
  assert.match(service, /aes-256-gcm/);
  assert.match(controller, /Pre-restore safety/);
  assert.match(controller, /Backup belongs to a different tenant/);
  assert.match(controller, /session\.withTransaction/);
});

test('unsafe production proxy/local-tenant modes are release blockers', () => {
  const env = validEnv();
  env.TRUST_PROXY = 'true';
  env.ALLOW_LOCALHOST_TENANTS = 'true';
  const result = readiness.validateProductionReadiness(env, { nodeVersion: readiness.PINNED_NODE_VERSION });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /TRUST_PROXY=true/);
  assert.match(result.errors.join('\n'), /ALLOW_LOCALHOST_TENANTS/);
});

test('release package includes a deterministic production runbook and preflight command', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['release:preflight'], 'npm run release:readiness && npm test && npm run check');
  const doc = read('docs/PRODUCTION_RELEASE_CANDIDATE.md');
  for (const marker of ['Node 24.11.1','npm ci','npm audit --omit=dev --audit-level=low','npm run release:readiness','npm run indexes','GET /healthz','GET /readyz','Multi-tenant isolation','Backup and restore rehearsal']) {
    assert.ok(doc.includes(marker), marker);
  }
  assert.doesNotMatch(doc, /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/);
});
