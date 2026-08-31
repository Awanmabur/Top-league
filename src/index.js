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
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");

const session = require("express-session");
const MongoStore = require("connect-mongo");
const flash = require("connect-flash");
const { getRedisClient, connectRedis, closeRedis } = require("./config/redis");
const { createRedisSessionStore } = require("./services/redisSessionStore");
const { RedisRateLimitStore } = require("./services/redisRateLimitStore");

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
const { startAnnouncementScheduler, stopAnnouncementScheduler } = require("./services/tenant/announcementScheduler");
const { startMessageScheduler, stopMessageScheduler } = require("./services/tenant/messageScheduler");
const { startEventScheduler, stopEventScheduler } = require("./services/tenant/eventScheduler");
const { startLeaveScheduler, stopLeaveScheduler } = require("./services/tenant/leaveScheduler");
const { startBackupScheduler, stopBackupScheduler } = require("./services/tenant/backupScheduler");
const { startPlatformSubscriptionScheduler, stopPlatformSubscriptionScheduler } = require("./services/platformSubscriptionScheduler");

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

function dbStateLabel(connection) {
  const states = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };

  return states[connection?.readyState] || "unknown";
}

function logStartup(port) {
  console.log(`Classic Academy running on port ${port} in ${process.env.NODE_ENV || "development"} mode`);
  console.log(`Platform DB: ${dbStateLabel(platformConnection)}`);
  console.log(`Redis: ${redisClient?.isReady?.() ? "connected" : "not configured"}`);
  console.log("Tenant DBs: connect on demand");
}

validateRuntimeConfig();
app.disable("x-powered-by");

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

const redisClient = getRedisClient();
const useRedisSessions = Boolean(redisClient) && (isProd || process.env.USE_REDIS_SESSIONS === "1");
const useRedisRateLimits = Boolean(redisClient) && (isProd || process.env.USE_REDIS_RATE_LIMITS === "1");
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

// ======================================
// TRUST PROXY
// ======================================
app.set("trust proxy", TRUST_PROXY);

// ======================================
// STATIC FILES
// ======================================
// The service worker must never be cached long-term, or clients can be stuck
// on a stale version for up to the static maxAge below.
app.get("/sw.js", (req, res, next) => {
  res.setHeader("Cache-Control", "no-cache");
  next();
});

app.use(
  express.static(path.join(__dirname, "..", "public"), {
    maxAge: isProd ? "30d" : 0,
    etag: true,
  }),
);

// ======================================
// GLOBAL MIDDLEWARES
// ======================================
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
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
          "https://cdn.jsdelivr.net",
        ],
        "script-src-elem": [
          "'self'",
          (req, res) => `'nonce-${res.locals.cspNonce}'`,
          "https://cdn.jsdelivr.net",
        ],
        "style-src": [
          "'self'",
          "'unsafe-inline'",
          "https://cdnjs.cloudflare.com",
          "https://cdn.jsdelivr.net",
          "https://fonts.googleapis.com",
        ],
        "style-src-elem": [
          "'self'",
          "'unsafe-inline'",
          "https://cdnjs.cloudflare.com",
          "https://cdn.jsdelivr.net",
          "https://fonts.googleapis.com",
        ],
        "font-src": [
          "'self'",
          "data:",
          "https://cdnjs.cloudflare.com",
          "https://cdn.jsdelivr.net",
          "https://fonts.gstatic.com",
        ],
        "img-src": ["'self'", "data:", "blob:", "https:"],
        "connect-src": ["'self'", "https://cdn.jsdelivr.net"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "frame-ancestors": ["'self'"],
        "form-action": ["'self'"],
      },
    },
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

app.use(compression());

app.use(cors(getCorsOptions()));

if (!isProd && process.env.HTTP_LOGS === "1") {
  app.use(morgan("dev"));
}

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    ...(useRedisRateLimits ? { store: new RedisRateLimitStore({ redisClient, prefix: "classic-academy:rl:global:" }) } : {}),
  }),
);

// Infrastructure probes intentionally expose no tenant/database metadata.
app.get("/healthz", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ status: "ok" });
});
app.get("/readyz", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const redisReady = !isProd || Boolean(redisClient?.isReady?.());
  const ready = platformConnection.readyState === 1 && redisReady;
  return res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not_ready" });
});

if (isProd) {
  app.use((req, res, next) => {
    const proto = req.header("x-forwarded-proto");
    if (proto && proto !== "https") {
      return res.redirect(301, "https://" + req.headers.host + req.originalUrl);
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
    rolling: true,
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

const tenantSession = session({
    name: "tenant.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
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
      startAnnouncementScheduler();
      startMessageScheduler();
      startEventScheduler();
      startLeaveScheduler();
      startBackupScheduler();
      startPlatformSubscriptionScheduler();
    });

    const shutdown = (signal) => {
      console.log(`${signal} received, shutting down gracefully...`);
      stopAnnouncementScheduler();
      stopMessageScheduler();
      stopEventScheduler();
      stopLeaveScheduler();
      stopBackupScheduler();
      stopPlatformSubscriptionScheduler();
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

