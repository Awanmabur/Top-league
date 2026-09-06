require("dotenv").config({ quiet: true });

// Fail before opening database sockets or loading integration clients when a
// production deployment does not satisfy the release contract.
if (process.env.NODE_ENV === "production") {
  require("./config/productionReadiness").assertProductionReadiness(process.env);
}

if (process.env.NODE_DEPRECATION_LOGS !== "1") {
  process.noDeprecation = true;
}

const express = require("express");
const path = require("path");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const zlib = require("zlib");

const session = require("express-session");
const MongoStore = require("connect-mongo");
const flash = require("connect-flash");
const { getRedisClient, connectRedis, closeRedis, isRedisRoleEnabled } = require("./config/redis");
const { createRedisSessionStore } = require("./services/redisSessionStore");

const { platformConnection, waitForPlatform } = require("./config/db");
const {
  isProduction,
  SESSION_TTL_SECONDS,
  SESSION_TOUCH_AFTER_SECONDS,
  getTrustedProxySetting,
  getSessionCookieOptions,
  getCorsOptions,
  validateRuntimeConfig,
} = require("./config/runtime");
const {
  rejectPoisonedPayload,
  enforceSameOrigin,
  disableSensitiveCaching,
} = require("./middleware/security/requestHardening");

// Middlewares
const tenantResolver = require("./middleware/tenant/tenantResolver");
const errorHandler = require("./middleware/tenant/errorHandler");

// Routes
const platformRoutes = require("./routes/platform");
const tenantRouter = require("./routes/tenant/tenant");
const { csrfProtection, attachCsrfToken } = require("./middleware/tenant/csrf");
const { startAnnouncementScheduler, stopAnnouncementScheduler } = require("./services/tenant/announcementScheduler");
const { startMessageScheduler, stopMessageScheduler } = require("./services/tenant/messageScheduler");
const { startEventScheduler, stopEventScheduler } = require("./services/tenant/eventScheduler");
const { startLeaveScheduler, stopLeaveScheduler } = require("./services/tenant/leaveScheduler");
const { startBackupScheduler, stopBackupScheduler } = require("./services/tenant/backupScheduler");
const { startPlatformSubscriptionScheduler, stopPlatformSubscriptionScheduler } = require("./services/platformSubscriptionScheduler");
const { shouldRunSchedulersInWeb } = require("./services/schedulerTiming");
const { startGoogleCalendarHealthScheduler, stopGoogleCalendarHealthScheduler } = require("./services/googleCalendarHealthScheduler");

const app = express();
const isProd = isProduction;
const PLATFORM_PATHS = [
  "/platform",
  "/super-admin",
  "/login",
  "/logout",
  "/forgot-password",
  "/reset-password",
];
const TRUST_PROXY = getTrustedProxySetting();

function isReadOnlyPublicSchoolPage(req) {
  const method = String(req.method || "GET").toUpperCase();
  return (method === "GET" || method === "HEAD") && /^\/schools(?:\/|$)/.test(String(req.path || ""));
}

function safeRequestAuthority(req) {
  const raw = String(req.get?.("host") || req.headers?.host || "").trim().toLowerCase();
  if (!raw || raw.length > 260 || /[\r\n\s/@\\]/.test(raw)) return "";

  // Custom tenant domains are valid, so production cannot use one fixed host.
  // Restrict the reflected authority to a DNS/IPv4/localhost host plus an
  // optional numeric port and reject header/path/userinfo injection.
  const authority = /^(?:localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?|(?:\d{1,3}\.){3}\d{1,3})(?::\d{1,5})?$/i;
  if (!authority.test(raw)) return "";
  return raw;
}

function dbStateLabel(connection) {
  const states = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };

  return states[connection?.readyState] || "unknown";
}

function redisStartupLabel() {
  if (!String(process.env.REDIS_URL || "").trim()) return "not configured";
  const enabledRoles = ["session", "rate", "cache"].filter((role) => isRedisRoleEnabled(role));
  if (!enabledRoles.length) return "disabled in development";
  const readyRoles = enabledRoles.filter((role) => getRedisClient(role)?.isReady?.());
  return readyRoles.length === enabledRoles.length
    ? `connected (${enabledRoles.join(", ")})`
    : `degraded (${readyRoles.length}/${enabledRoles.length} roles connected)`;
}

function logStartup(port) {
  console.log(`Classic Academy running on port ${port} in ${process.env.NODE_ENV || "development"} mode`);
  console.log(`Platform DB: ${dbStateLabel(platformConnection)}`);
  console.log(`Redis: ${redisStartupLabel()}`);
  console.log("Tenant DBs: connect on demand");
}

validateRuntimeConfig();
app.disable("x-powered-by");
// Keep query strings flat. This removes nested query-selector objects from the
// public attack surface and reduces parser work for every GET request.
app.set("query parser", "simple");

if (process.env.PERF_LOGS === "1") {
  const slowRequestMs = Math.max(100, Math.min(10000, Number(process.env.SLOW_REQUEST_MS || 500)));
  app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.once("finish", () => {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      if (elapsedMs >= slowRequestMs) {
        console.warn(`[slow-request] ${req.method} ${req.originalUrl} ${res.statusCode} ${elapsedMs.toFixed(1)}ms`);
      }
    });
    next();
  });
}

const redisClient = getRedisClient("session");
const useRedisSessions = Boolean(redisClient) && (isProd || process.env.USE_REDIS_SESSIONS === "1");
const mongoSessionStore = !useRedisSessions
  ? MongoStore.create({
      client: platformConnection.getClient(),
      ttl: SESSION_TTL_SECONDS,
      touchAfter: SESSION_TOUCH_AFTER_SECONDS,
    })
  : null;
const platformSessionStore = useRedisSessions
  ? createRedisSessionStore({ redisClient, prefix: "classic-academy:session:platform:", fallbackTtlSeconds: SESSION_TTL_SECONDS })
  : mongoSessionStore;
const tenantSessionStore = useRedisSessions
  ? createRedisSessionStore({ redisClient, prefix: "classic-academy:session:tenant:", fallbackTtlSeconds: SESSION_TTL_SECONDS })
  : mongoSessionStore;

if (mongoSessionStore && typeof mongoSessionStore.on === "function") {
  mongoSessionStore.on("error", (err) => {
    console.error("Session store error:", err?.message || err);
  });
}

// ======================================
// VIEW ENGINE
// ======================================
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));
app.set("view cache", isProd);

// ======================================
// TRUST PROXY
// ======================================
app.set("trust proxy", TRUST_PROXY);

// ======================================
// STATIC FILES
// ======================================
// Compression must run before express.static so CSS/JS/SVG/text assets are
// compressed instead of bypassing the compressor on their hottest path.
app.use(compression({
  threshold: 1024,
  level: 4,
  brotli: {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
    },
  },
}));

// The service worker must never be cached long-term, or clients can be stuck
// on a stale version for up to the static maxAge below.
app.get("/sw.js", (req, res, next) => {
  res.setHeader("Cache-Control", "no-cache, max-age=0, must-revalidate");
  next();
});

app.use(
  express.static(path.join(__dirname, "..", "public"), {
    // Per-file Cache-Control is set below. Keep the express default short so
    // unhashed JS/CSS cannot remain stale for a month after a deployment.
    maxAge: 0,
    etag: true,
    lastModified: true,
    setHeaders(res, filePath) {
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (!isProd) return;

      const normalized = String(filePath || "").replace(/\\/g, "/").toLowerCase();
      const base = path.posix.basename(normalized);
      if (base === "sw.js") {
        res.setHeader("Cache-Control", "no-cache, max-age=0, must-revalidate");
        return;
      }

      // Stable media/vendor assets are expensive but rarely change. App JS/CSS
      // uses a shorter cache because filenames are not content-hashed yet.
      if (/\/(?:img|assets|vendor)\//.test(normalized) || /\.(?:webp|png|jpe?g|svg|ico|woff2?)$/.test(normalized)) {
        res.setHeader("Cache-Control", "public, max-age=2592000, stale-while-revalidate=604800");
      } else if (/\.(?:js|css)$/.test(normalized)) {
        res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
      } else {
        res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
      }
    },
  }),
);

// ======================================
// GLOBAL MIDDLEWARES
// ======================================
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb", parameterLimit: 500, depth: 5 }));
app.use(cookieParser(process.env.SESSION_SECRET));
app.use(rejectPoisonedPayload);
app.use(disableSensitiveCaching);
app.use(enforceSameOrigin);

app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": [
          "'self'",
          (req, res) => `'nonce-${res.locals.cspNonce}'`,
        ],
        "script-src-elem": [
          "'self'",
          (req, res) => `'nonce-${res.locals.cspNonce}'`,
        ],
        "style-src": [
          "'self'",
          "'unsafe-inline'",
          "https://cdnjs.cloudflare.com",
          "https://fonts.googleapis.com",
        ],
        "style-src-elem": [
          "'self'",
          (req, res) => `'nonce-${res.locals.cspNonce}'`,
          "https://cdnjs.cloudflare.com",
          "https://fonts.googleapis.com",
        ],
        "style-src-attr": ["'unsafe-inline'"],
        "font-src": [
          "'self'",
          "data:",
          "https://cdnjs.cloudflare.com",
          "https://fonts.gstatic.com",
        ],
        "img-src": ["'self'", "data:", "blob:", "https:"],
        "connect-src": ["'self'"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "frame-ancestors": ["'self'"],
        "form-action": ["'self'"],
        // Contact embeds only the fixed Google Maps location. Keep frame access
        // narrowly scoped instead of opening all HTTPS framing.
        "frame-src": ["'self'", "https://www.google.com"],
      },
    },
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

app.use((req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  );
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  next();
});

app.use(cors(getCorsOptions()));

if (!isProd && process.env.HTTP_LOGS === "1") {
  app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    res.once("finish", () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const path = String(req.path || "/").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "?").slice(0, 300);
      console.log(`[http] ${String(req.method || "GET").slice(0, 12)} ${path} ${res.statusCode} ${ms.toFixed(1)}ms`);
    });
    next();
  });
}

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    // Keep broad request shaping local so ordinary page loads do not pay a
    // network round-trip. High-risk auth/booking/inquiry/review limiters stay
    // distributed through Redis in their route-specific middleware.
  }),
);

// Infrastructure probes intentionally expose no tenant/database metadata.
app.get("/healthz", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  return res.status(200).json({ status: "ok" });
});
app.get("/readyz", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  const redisReady = !isProd || Boolean(redisClient?.isReady?.());
  const ready = platformConnection.readyState === 1 && redisReady;
  return res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not_ready" });
});

if (isProd) {
  app.use((req, res, next) => {
    const proto = req.header("x-forwarded-proto");
    if (proto && proto !== "https") {
      const authority = safeRequestAuthority(req);
      if (!authority) return res.status(400).send("Invalid request host.");
      return res.redirect(308, `https://${authority}${req.originalUrl}`);
    }
    next();
  });
}

/* =======================================================
   PLATFORM SESSION + FLASH (ONLY /platform)
======================================================= */
app.use(
  PLATFORM_PATHS,
  session({
    name: "platform.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: false,
    unset: "destroy",
    proxy: Boolean(TRUST_PROXY),
    store: platformSessionStore,
    cookie: getSessionCookieOptions(),
  }),
);

app.use(PLATFORM_PATHS, flash());

app.use(PLATFORM_PATHS, (req, res, next) => {
  const f = typeof req.flash === "function" ? req.flash.bind(req) : null;
  res.locals.flash = {
    success: f ? f("success") : [],
    error: f ? f("error") : [],
    info: f ? f("info") : [],
    warning: f ? f("warning") : [],
  };
  next();
});

/* =======================================================
   TENANT RESOLVER
======================================================= */
app.use(tenantResolver);

/* =======================================================
   TENANT STACK
======================================================= */
const tenantStack = express.Router();

// Expose one validated absolute tenant origin to public EJS templates so
// canonical/Open Graph/schema URLs never reflect an unsafe Host header.
tenantStack.use((req, res, next) => {
  const authority = safeRequestAuthority(req);
  const protocol = req.secure || req.protocol === "https" ? "https" : "http";
  res.locals.tenantPublicSiteUrl = authority ? `${protocol}://${authority}` : "";
  next();
});

const tenantSession = session({
    name: "tenant.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: false,
    unset: "destroy",
    proxy: Boolean(TRUST_PROXY),
    store: tenantSessionStore,
    cookie: getSessionCookieOptions(),
  });

tenantStack.use((req, res, next) => {
  if (isReadOnlyPublicSchoolPage(req)) return next();
  return tenantSession(req, res, next);
});

const tenantFlash = flash();

tenantStack.use((req, res, next) => {
  if (isReadOnlyPublicSchoolPage(req)) return next();
  return tenantFlash(req, res, next);
});

tenantStack.use((req, res, next) => {
  if (isReadOnlyPublicSchoolPage(req)) {
    res.locals.flash = { success: [], error: [], info: [], warning: [] };
    return next();
  }

  const f = typeof req.flash === "function" ? req.flash.bind(req) : null;
  res.locals.flash = {
    success: f ? f("success") : [],
    error: f ? f("error") : [],
    info: f ? f("info") : [],
    warning: f ? f("warning") : [],
  };
  next();
});

tenantStack.use(csrfProtection, attachCsrfToken);

tenantStack.use(tenantRouter);

/* =======================================================
   SINGLE DISPATCHER
======================================================= */
app.use((req, res, next) => {
  if (req.tenant) {
    return tenantStack(req, res, next);
  }
  return platformRoutes(req, res, next);
});

/* =======================================================
   ERROR HANDLER
======================================================= */
app.use(errorHandler);

/* =======================================================
   BOOTSTRAP
======================================================= */
(async () => {
  try {
    const redisStartup = connectRedis().catch((err) => {
      if (isProd) throw err;
      console.warn("Redis unavailable in development; continuing with Mongo sessions and local rate limits:", err?.message || err);
      return null;
    });
    await Promise.all([waitForPlatform(), redisStartup]);
    const port = process.env.PORT || 3000;

    const server = app.listen(port, () => {
      logStartup(port);
      if (shouldRunSchedulersInWeb()) {
        startAnnouncementScheduler();
        startMessageScheduler();
        startEventScheduler();
        startLeaveScheduler();
        startBackupScheduler();
        startPlatformSubscriptionScheduler();
        startGoogleCalendarHealthScheduler();
      } else {
        console.log("Background schedulers: external worker mode");
      }
    });

    // Bound slow-header/slow-body sockets so one client cannot occupy a worker
    // indefinitely. Keep-alive remains enabled for fast repeat navigation.
    const boundedHttpInt = (name, fallback, min, max) => {
      const parsed = Number(process.env[name]);
      return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
    };
    server.requestTimeout = boundedHttpInt("HTTP_REQUEST_TIMEOUT_MS", 30_000, 5_000, 120_000);
    server.headersTimeout = Math.min(
      server.requestTimeout,
      boundedHttpInt("HTTP_HEADERS_TIMEOUT_MS", 15_000, 5_000, 60_000),
    );
    server.keepAliveTimeout = boundedHttpInt("HTTP_KEEP_ALIVE_TIMEOUT_MS", 5_000, 1_000, 30_000);
    server.maxRequestsPerSocket = boundedHttpInt("HTTP_MAX_REQUESTS_PER_SOCKET", 1_000, 100, 10_000);
    server.maxHeadersCount = boundedHttpInt("HTTP_MAX_HEADERS_COUNT", 100, 32, 256);

    const shutdown = (signal) => {
      console.log(`${signal} received, shutting down gracefully...`);
      stopAnnouncementScheduler();
      stopMessageScheduler();
      stopEventScheduler();
      stopLeaveScheduler();
      stopBackupScheduler();
      stopPlatformSubscriptionScheduler();
      stopGoogleCalendarHealthScheduler();
      server.close(async () => {
        try {
          await Promise.allSettled([platformConnection.close(), closeRedis()]);
        } catch (_) {}
        process.exit(0);
      });
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (err) {
    console.error(`Platform DB: ${dbStateLabel(platformConnection)}`);
    console.error("Failed to start server:", err.message || err);
    process.exit(1);
  }
})();

