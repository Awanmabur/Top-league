require("dotenv").config({ quiet: true });

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

const { waitForPlatform } = require("./config/db");

// Middlewares
const tenantResolver = require("./middleware/tenant/tenantResolver");
const errorHandler = require("./middleware/tenant/errorHandler");

// Routes
const platformRoutes = require("./routes/platform");
const tenantRouter = require("./routes/tenant/tenant");

const app = express();
const isProd = process.env.NODE_ENV === "production";
const PLATFORM_PATHS = ["/platform", "/super-admin"];

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

function validateCoreEnv() {
  requireEnv("SESSION_SECRET", { minLength: isProd ? 32 : 12 });
  requireEnv("JWT_SECRET", { minLength: isProd ? 32 : 12 });
}

validateCoreEnv();
app.disable("x-powered-by");

// ======================================
// VIEW ENGINE
// ======================================
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));

// ======================================
// TRUST PROXY
// ======================================
app.set("trust proxy", 1);

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
app.use(cookieParser());

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

app.use(
  cors({
    origin: isProd ? false : true,
    credentials: true,
  }),
);

if (!isProd) {
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
    store: MongoStore.create({
      mongoUrl: process.env.PLATFORM_DB_URI,
      ttl: 7 * 24 * 60 * 60,
    }),
    cookie: {
      path: "/",
      secure: isProd,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
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

tenantStack.use(
  session({
    name: "tenant.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.PLATFORM_DB_URI,
      ttl: 7 * 24 * 60 * 60,
    }),
    cookie: {
      path: "/",
      secure: isProd,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

tenantStack.use(flash());

tenantStack.use((req, res, next) => {
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

    app.listen(port, () => {
      console.log(
        `Classic Academy running on port ${port} in ${process.env.NODE_ENV || "development"} mode`,
      );
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
})();
