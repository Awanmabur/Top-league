const crypto = require("crypto");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}\.[A-Za-z0-9_-]{32,128}$/;

function csrfError(message = "Invalid or expired CSRF token.") {
  const err = new Error(message);
  err.code = "EBADCSRFTOKEN";
  err.status = 403;
  return err;
}

function ensureSecret(req) {
  if (!req.session) return null;
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(String(req.session._csrfSecret || ""))) {
    req.session._csrfSecret = crypto.randomBytes(32).toString("base64url");
  }
  return req.session._csrfSecret;
}

function tokenFor(secret) {
  const nonce = crypto.randomBytes(18).toString("base64url");
  const mac = crypto.createHmac("sha256", secret).update(`classic-academy-csrf-v1\0${nonce}`).digest("base64url");
  return `${nonce}.${mac}`;
}

function validToken(secret, candidate) {
  const token = String(candidate || "").trim();
  if (!secret || !TOKEN_RE.test(token) || token.length > 256) return false;
  const dot = token.indexOf(".");
  const nonce = token.slice(0, dot);
  const supplied = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", secret).update(`classic-academy-csrf-v1\0${nonce}`).digest("base64url");
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requestToken(req) {
  return req.body?._csrf
    || req.get?.("x-csrf-token")
    || req.get?.("x-xsrf-token")
    || req.get?.("csrf-token")
    || "";
}


function strongSameOriginEvidence(req) {
  const fetchSite = String(req.get?.("sec-fetch-site") || "").toLowerCase();
  if (fetchSite === "same-origin") return true;

  const rawOrigin = String(req.get?.("origin") || "").trim();
  if (!rawOrigin) return false;
  try {
    const originUrl = new URL(rawOrigin);
    return originUrl.host.toLowerCase() === String(req.get?.("host") || "").trim().toLowerCase();
  } catch {
    return false;
  }
}

function isMultipart(req) {
  return /^multipart\/form-data(?:;|$)/i.test(String(req.get?.("content-type") || ""));
}

function installTokenFactory(req, secret) {
  req.csrfToken = () => tokenFor(secret);
}

function csrfProtection(req, _res, next) {
  const method = String(req.method || "GET").toUpperCase();

  // Bearer-authenticated API clients are not cookie-authenticated and are not
  // vulnerable to browser CSRF. Their authorization layer remains mandatory.
  if (!SAFE_METHODS.has(method) && req.headers?.authorization) return next();

  const secret = ensureSecret(req);
  if (!secret) {
    // Read-only school marketing pages intentionally avoid creating sessions.
    if (SAFE_METHODS.has(method)) {
      req.csrfToken = () => "";
      return next();
    }
    return next(csrfError("A session is required for this request."));
  }

  installTokenFactory(req, secret);
  if (SAFE_METHODS.has(method)) return next();

  // Multer parses multipart fields later in the route chain. Mark the request
  // and require the post-Multer verifier from the shared upload validators.
  if (isMultipart(req)) {
    req._csrfMultipartPending = true;
    return next();
  }

  if (!validToken(secret, requestToken(req)) && !strongSameOriginEvidence(req)) return next(csrfError());
  return next();
}

function csrfMultipartProtection(req, _res, next) {
  if (!req._csrfMultipartPending) return next();
  const secret = ensureSecret(req);
  if (!validToken(secret, requestToken(req)) && !strongSameOriginEvidence(req)) return next(csrfError());
  req._csrfMultipartPending = false;
  return next();
}

function attachCsrfToken(req, res, next) {
  res.locals.csrfToken = typeof req.csrfToken === "function" ? req.csrfToken() : null;
  next();
}

module.exports = {
  csrfProtection,
  csrfMultipartProtection,
  attachCsrfToken,
  validToken,
};
