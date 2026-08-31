const net = require('net');

const PINNED_NODE_VERSION = '24.11.1';

function byteLength(value) {
  return Buffer.byteLength(String(value || ''), 'utf8');
}

function isHttpsUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' && !!url.hostname;
  } catch (_) {
    return false;
  }
}


function isMongoUrl(value) {
  const raw = String(value || '').trim();
  return /^mongodb(?:\+srv)?:\/\//i.test(raw);
}

function isRedisUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['redis:', 'rediss:'].includes(url.protocol) && !!url.hostname;
  } catch (_) {
    return false;
  }
}

function isHostname(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw.includes('://') || raw.includes('/') || raw.includes(':')) return false;
  if (raw === 'localhost' || net.isIP(raw)) return false;
  if (raw.length > 253) return false;
  return raw.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

function has32ByteBackupKey(value) {
  const raw = String(value || '').trim();
  if (/^[a-f\d]{64}$/i.test(raw)) return true;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return false;
  try {
    return Buffer.from(raw, 'base64').length === 32;
  } catch (_) {
    return false;
  }
}

function validateProductionReadiness(env = process.env, options = {}) {
  const nodeVersion = String(options.nodeVersion || process.versions.node || '');
  const errors = [];
  const warnings = [];
  const checks = [];

  function check(name, ok, message) {
    checks.push({ name, ok: Boolean(ok) });
    if (!ok) errors.push(message);
  }

  function secret(name, minBytes = 32) {
    check(name, byteLength(env[name]) >= minBytes, `${name} must be configured with at least ${minBytes} bytes.`);
  }

  check('node.version', nodeVersion === PINNED_NODE_VERSION, `Node ${PINNED_NODE_VERSION} is required; current runtime is ${nodeVersion || 'unknown'}.`);
  check('PLATFORM_DB_URI', isMongoUrl(env.PLATFORM_DB_URI), 'PLATFORM_DB_URI must be a MongoDB connection URI.');
  check('tenant.mongo', isMongoUrl(env.MONGO_URI_BASE || env.MONGO_URI), 'MONGO_URI_BASE or MONGO_URI must be a MongoDB connection URI.');
  check('REDIS_URL', isRedisUrl(env.REDIS_URL), 'REDIS_URL must be a redis:// or rediss:// connection URI in production.');

  secret('SESSION_SECRET');
  secret('JWT_SECRET');
  secret('INVITE_TOKEN_SECRET');
  secret('TRANSCRIPT_SIGNING_SECRET');
  secret('DOCUMENT_SIGNING_SECRET');
  secret('INTEGRATION_CREDENTIAL_ENCRYPTION_KEY');
  secret('PLATFORM_AUDIT_PRIVACY_SECRET');
  secret('PUBLIC_REVIEW_FINGERPRINT_SECRET');
  check('TENANT_BACKUP_KEY', has32ByteBackupKey(env.TENANT_BACKUP_KEY), 'TENANT_BACKUP_KEY must decode to exactly 32 bytes (64 hex characters or base64).');

  check('BASE_DOMAIN', isHostname(env.BASE_DOMAIN), 'BASE_DOMAIN must be a valid production hostname without protocol or path.');
  for (const name of ['PUBLIC_SITE_URL', 'PLATFORM_SITE_URL', 'APP_PUBLIC_URL']) {
    check(name, isHttpsUrl(env[name]), `${name} must be an absolute HTTPS URL.`);
  }
  if (env.MAIN_SITE_URL) check('MAIN_SITE_URL', isHttpsUrl(env.MAIN_SITE_URL), 'MAIN_SITE_URL must be an absolute HTTPS URL when configured.');

  for (const name of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM']) {
    check(name, String(env[name] || '').trim().length > 0, `${name} is required in production.`);
  }
  const smtpPort = Number(env.SMTP_PORT);
  check('SMTP_PORT', Number.isInteger(smtpPort) && smtpPort >= 1 && smtpPort <= 65535, 'SMTP_PORT must be an integer between 1 and 65535.');

  for (const name of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
    check(name, String(env[name] || '').trim().length > 0, `${name} is required for production artifact/media storage.`);
  }

  for (const name of [
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'GOOGLE_OAUTH_REFRESH_TOKEN',
    'ZOOM_ACCOUNT_ID',
    'ZOOM_CLIENT_ID',
    'ZOOM_CLIENT_SECRET',
  ]) {
    check(name, String(env[name] || '').trim().length > 0, `${name} is required because public demo booking is enabled.`);
  }
  check('GOOGLE_OAUTH_REDIRECT_URI', isHttpsUrl(env.GOOGLE_OAUTH_REDIRECT_URI), 'GOOGLE_OAUTH_REDIRECT_URI must be an absolute HTTPS URL.');

  for (const flag of ['DEBUG_AUTH_TOKENS', 'DEBUG_PERF', 'HTTP_LOGS', 'AUTO_CREATE_PARENT_PROFILE', 'ALLOW_INSECURE_INTEGRATION_HTTP', 'ALLOW_LOCALHOST_TENANTS']) {
    const enabled = ['1', 'true', 'yes', 'on'].includes(String(env[flag] || '').trim().toLowerCase());
    check(`unsafe.${flag}`, !enabled, `${flag} must be disabled in production.`);
  }

  check('TRUST_PROXY', String(env.TRUST_PROXY || '').trim().toLowerCase() !== 'true', 'TRUST_PROXY=true trusts every proxy hop; use an exact hop count or trusted proxy range.');

  return { ok: errors.length === 0, errors, warnings, checks, pinnedNodeVersion: PINNED_NODE_VERSION };
}

function assertProductionReadiness(env = process.env, options = {}) {
  const result = validateProductionReadiness(env, options);
  if (!result.ok) {
    const err = new Error(`Production readiness failed:\n- ${result.errors.join('\n- ')}`);
    err.code = 'PRODUCTION_READINESS_FAILED';
    err.readiness = result;
    throw err;
  }
  return result;
}

module.exports = {
  PINNED_NODE_VERSION,
  byteLength,
  isHttpsUrl,
  isMongoUrl,
  isRedisUrl,
  isHostname,
  has32ByteBackupKey,
  validateProductionReadiness,
  assertProductionReadiness,
};
