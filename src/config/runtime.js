const isProduction = process.env.NODE_ENV === "production";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
const SESSION_TOUCH_AFTER_SECONDS = 24 * 60 * 60;
const POISON_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function safeLower(value) {
  return String(value || "").trim().toLowerCase();
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function requireEnv(name, options = {}) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  if (options.minLength && String(value).length < options.minLength) {
    throw new Error(`${name} must be at least ${options.minLength} characters.`);
  }

  return value;
}

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(safeLower(raw));
}

function getTrustedProxySetting() {
  if (process.env.TRUST_PROXY !== undefined) {
    const raw = String(process.env.TRUST_PROXY).trim();
    if (/^\d+$/.test(raw)) return Number(raw);
    if (["true", "false"].includes(safeLower(raw))) {
      return safeLower(raw) === "true";
    }
    return raw;
  }

  return isProduction ? 1 : false;
}

function shouldUseCookieDomain(hostname, baseDomain) {
  if (!hostname || !baseDomain) return false;
  const host = safeLower(hostname);
  const base = safeLower(baseDomain);

  if (host === "localhost" || host.endsWith(".localhost")) return false;
  return host === base || host.endsWith(`.${base}`);
}

function getTenantCookieOptions(req) {
  const hostname = req.hostname;
  const baseDomain = process.env.BASE_DOMAIN;
  const options = {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
    path: "/",
  };

  if (isProduction && shouldUseCookieDomain(hostname, baseDomain)) {
    options.domain = `.${safeLower(baseDomain)}`;
  }

  return options;
}

function getSessionCookieOptions() {
  return {
    path: "/",
    secure: isProduction,
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
  };
}

function getCorsOptions() {
  const allowedOrigins = new Set(parseCsv(process.env.CORS_ALLOWED_ORIGINS));

  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (!isProduction) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-CSRF-Token"],
    maxAge: 60 * 60,
  };
}

function validateRuntimeConfig() {
  requireEnv("PLATFORM_DB_URI");
  if (!process.env.MONGO_URI_BASE && !process.env.MONGO_URI) {
    throw new Error("Missing MONGO_URI_BASE or MONGO_URI");
  }
  requireEnv("SESSION_SECRET", { minLength: isProduction ? 32 : 12 });
  requireEnv("JWT_SECRET", { minLength: isProduction ? 32 : 12 });

  if (isProduction) {
    requireEnv("BASE_DOMAIN");
    requireEnv("INVITE_TOKEN_SECRET", { minLength: 32 });
    requireEnv("TRANSCRIPT_SIGNING_SECRET", { minLength: 32 });
    requireEnv("SMTP_HOST");
    requireEnv("SMTP_PORT");
    requireEnv("SMTP_USER");
    requireEnv("SMTP_PASS");

    const blockedDebugFlags = [
      "DEBUG_AUTH_TOKENS",
      "DEBUG_PERF",
      "HTTP_LOGS",
      "AUTO_CREATE_PARENT_PROFILE",
    ].filter((name) => boolEnv(name, false));

    if (blockedDebugFlags.length) {
      throw new Error(
        `Disable debug-only flags in production: ${blockedDebugFlags.join(", ")}`,
      );
    }
  }
}

function isPoisonKey(key) {
  return POISON_KEYS.has(String(key || ""));
}

module.exports = {
  isProduction,
  SESSION_TTL_SECONDS,
  SESSION_TTL_MS,
  SESSION_TOUCH_AFTER_SECONDS,
  boolEnv,
  safeLower,
  parseCsv,
  getTrustedProxySetting,
  shouldUseCookieDomain,
  getTenantCookieOptions,
  getSessionCookieOptions,
  getCorsOptions,
  validateRuntimeConfig,
  isPoisonKey,
};
