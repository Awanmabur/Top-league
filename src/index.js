require("dotenv").config({ quiet: true });

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
  console.log("Tenant DBs: connect on demand");
}

validateRuntimeConfig();
app.disable("x-powered-by");

const sessionStore = MongoStore.create({
  client: platformConnection.getClient(),
  ttl: SESSION_TTL_SECONDS,
  touchAfter: SESSION_TOUCH_AFTER_SECONDS,
});
sessionStore.on("error", (err) => {
  console.error("Session store error:", err?.message || err);
});

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
  }),
);

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
    store: sessionStore,
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
    store: sessionStore,
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
    await waitForPlatform();
    const port = process.env.PORT || 3000;

    const server = app.listen(port, () => {
      logStartup(port);
    });

    const shutdown = (signal) => {
      console.log(`${signal} received, shutting down gracefully...`);
      server.close(async () => {
        try {
          await platformConnection.close();
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

