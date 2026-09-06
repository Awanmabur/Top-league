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

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function hasServiceAccountPrivateKey(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 32768 || !/^[A-Za-z0-9+/=]+$/.test(raw)) return false;
  try {
    const pem = Buffer.from(raw, 'base64').toString('utf8').trim();
    return pem.length >= 256
      && pem.length <= 20000
      && /^-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+-----END (?:RSA )?PRIVATE KEY-----$/.test(pem);
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
    'ZOOM_ACCOUNT_ID',
    'ZOOM_CLIENT_ID',
    'ZOOM_CLIENT_SECRET',
  ]) {
    check(name, String(env[name] || '').trim().length > 0, `${name} is required because public demo booking is enabled.`);
  }

  const googleAuthMode = String(env.GOOGLE_CALENDAR_AUTH_MODE || '').trim().toLowerCase();
  check(
    'GOOGLE_CALENDAR_AUTH_MODE',
    ['oauth', 'service_account'].includes(googleAuthMode),
    'GOOGLE_CALENDAR_AUTH_MODE must be explicitly set to oauth or service_account in production.',
  );

  const legacyGoogleToken = String(env.GOOGLE_OAUTH_REFRESH_TOKEN || '').trim();
  const legacyGoogleBootstrap = ['1', 'true', 'yes', 'on'].includes(String(env.GOOGLE_OAUTH_ALLOW_LEGACY_BOOTSTRAP || '').trim().toLowerCase());

  if (googleAuthMode === 'oauth') {
    for (const name of ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET']) {
      check(name, String(env[name] || '').trim().length > 0, `${name} is required because Google Calendar OAuth booking is enabled.`);
    }
    const googleRedirectValid = isHttpsUrl(env.GOOGLE_OAUTH_REDIRECT_URI);
    check('GOOGLE_OAUTH_REDIRECT_URI', googleRedirectValid, 'GOOGLE_OAUTH_REDIRECT_URI must be an absolute HTTPS URL.');
    if (googleRedirectValid) {
      let redirectPath = '';
      try { redirectPath = new URL(env.GOOGLE_OAUTH_REDIRECT_URI).pathname.replace(/\/+$/, ''); } catch (_) {}
      check(
        'GOOGLE_OAUTH_REDIRECT_URI.path',
        redirectPath === '/super-admin/settings/google-calendar/callback',
        'GOOGLE_OAUTH_REDIRECT_URI must end exactly with /super-admin/settings/google-calendar/callback.',
      );
    }
    const googleConsentStatus = String(env.GOOGLE_OAUTH_CONSENT_STATUS || '').trim().toLowerCase();
    check(
      'GOOGLE_OAUTH_CONSENT_STATUS',
      ['production', 'internal'].includes(googleConsentStatus),
      'GOOGLE_OAUTH_CONSENT_STATUS must be production or internal. Google Testing-mode refresh tokens expire and are not valid for durable public booking.',
    );
    check(
      'GOOGLE_OAUTH_REFRESH_TOKEN.runtime',
      !legacyGoogleToken || legacyGoogleBootstrap,
      'GOOGLE_OAUTH_REFRESH_TOKEN is not a production runtime credential. Remove it after connecting Google Calendar, or explicitly enable GOOGLE_OAUTH_ALLOW_LEGACY_BOOTSTRAP only for a controlled one-time migration.',
    );
    if (legacyGoogleBootstrap) {
      warnings.push('GOOGLE_OAUTH_ALLOW_LEGACY_BOOTSTRAP is enabled. Use it only for one controlled migration, reconnect Google Calendar from Super Admin settings, then remove both legacy Google token variables.');
    }
  } else if (googleAuthMode === 'service_account') {
    check('GOOGLE_SERVICE_ACCOUNT_EMAIL', isEmail(env.GOOGLE_SERVICE_ACCOUNT_EMAIL), 'GOOGLE_SERVICE_ACCOUNT_EMAIL must be the Google Cloud service-account email.');
    check('GOOGLE_SERVICE_ACCOUNT_SUBJECT', isEmail(env.GOOGLE_SERVICE_ACCOUNT_SUBJECT), 'GOOGLE_SERVICE_ACCOUNT_SUBJECT must be the Google Workspace organizer account to impersonate through domain-wide delegation.');
    check('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_B64', hasServiceAccountPrivateKey(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_B64), 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_B64 must be a base64-encoded PEM private key.');
    check('GOOGLE_CALENDAR_ID', String(env.GOOGLE_CALENDAR_ID || '').trim().length > 0, 'GOOGLE_CALENDAR_ID is required for service-account Calendar booking.');
    check('GOOGLE_OAUTH_REFRESH_TOKEN.runtime', !legacyGoogleToken, 'Remove GOOGLE_OAUTH_REFRESH_TOKEN when service-account Calendar authentication is enabled.');
    check('GOOGLE_OAUTH_ALLOW_LEGACY_BOOTSTRAP.runtime', !legacyGoogleBootstrap, 'GOOGLE_OAUTH_ALLOW_LEGACY_BOOTSTRAP must be disabled when service-account Calendar authentication is enabled.');
    warnings.push('Google Calendar service-account mode requires Google Workspace domain-wide delegation for calendar.events and calendar.events.freebusy, with GOOGLE_SERVICE_ACCOUNT_SUBJECT set to the intended organizer.');
  }

  for (const flag of ['DEBUG_AUTH_TOKENS', 'DEBUG_PERF', 'HTTP_LOGS', 'AUTO_CREATE_PARENT_PROFILE', 'ALLOW_INSECURE_INTEGRATION_HTTP', 'ALLOW_LOCALHOST_TENANTS']) {
    const enabled = ['1', 'true', 'yes', 'on'].includes(String(env[flag] || '').trim().toLowerCase());
    check(`unsafe.${flag}`, !enabled, `${flag} must be disabled in production.`);
  }

  check('TRUST_PROXY', String(env.TRUST_PROXY || '').trim().toLowerCase() !== 'true', 'TRUST_PROXY=true trusts every proxy hop; use an exact hop count or trusted proxy range.');

  const schedulerMode = String(env.RUN_SCHEDULERS_IN_WEB || '').trim().toLowerCase();
  check(
    'RUN_SCHEDULERS_IN_WEB',
    ['true', 'false'].includes(schedulerMode),
    'RUN_SCHEDULERS_IN_WEB must be explicitly true or false in production. Use false only when the dedicated scheduler worker is deployed and running.',
  );
  if (schedulerMode === 'false') {
    warnings.push('RUN_SCHEDULERS_IN_WEB=false requires the dedicated `node src/scheduler.js` worker to be provisioned and monitored in production.');
  }

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
  isEmail,
  hasServiceAccountPrivateKey,
  validateProductionReadiness,
  assertProductionReadiness,
};
