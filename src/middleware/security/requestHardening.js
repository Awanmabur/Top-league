const { isProduction, isPoisonKey, parseCsv } = require("../../config/runtime");

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SENSITIVE_ROUTE_PATTERN =
  /^\/(?:login|logout|forgot-password|reset-password|set-password|super-admin|platform|admin|student|parent|staff)(?:\/|$)/;
const ALLOWED_CROSS_SITE_ORIGINS = new Set(parseCsv(process.env.CORS_ALLOWED_ORIGINS));

function wantsJson(req) {
  const accept = String(req.headers.accept || "");
  return accept.includes("application/json") || req.xhr;
}

function hasPoisonKeys(value, seen = new Set()) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((entry) => hasPoisonKeys(entry, seen));
  }

  return Object.keys(value).some((key) => {
    if (isPoisonKey(key)) return true;
    return hasPoisonKeys(value[key], seen);
  });
}

function rejectPoisonedPayload(req, res, next) {
  const containers = [req.query, req.body, req.params];
  if (containers.some((value) => hasPoisonKeys(value))) {
    if (wantsJson(req)) {
      return res.status(400).json({ ok: false, message: "Invalid request payload." });
    }

    return res.status(400).send("Invalid request payload.");
  }

  return next();
}

function parseHeaderUrl(value) {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
}

function enforceSameOrigin(req, res, next) {
  if (!UNSAFE_METHODS.has(String(req.method || "").toUpperCase())) {
    return next();
  }

  if (req.headers.authorization) {
    return next();
  }

  const origin = parseHeaderUrl(req.get("origin"));
  const referer = parseHeaderUrl(req.get("referer"));
  const candidate = origin || referer;

  if (!candidate) {
    return next();
  }

  const requestHost = String(req.get("host") || "").toLowerCase();
  const candidateHost = String(candidate.host || "").toLowerCase();

  if (
    requestHost &&
    candidateHost &&
    requestHost !== candidateHost &&
    !ALLOWED_CROSS_SITE_ORIGINS.has(candidate.origin)
  ) {
    if (wantsJson(req)) {
      return res.status(403).json({ ok: false, message: "Cross-site request blocked." });
    }

    return res.status(403).send("Cross-site request blocked.");
  }

  return next();
}

function disableSensitiveCaching(req, res, next) {
  if (!SENSITIVE_ROUTE_PATTERN.test(String(req.path || ""))) {
    return next();
  }

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate, private",
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  if (isProduction) {
    res.setHeader("Surrogate-Control", "no-store");
  }

  return next();
}

module.exports = {
  rejectPoisonedPayload,
  enforceSameOrigin,
  disableSensitiveCaching,
};
