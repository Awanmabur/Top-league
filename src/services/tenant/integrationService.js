const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");
const http = require("http");
const https = require("https");

function str(v) { return String(v ?? "").trim(); }
function isProduction() { return String(process.env.APP_ENV || process.env.NODE_ENV || "").toLowerCase() === "production"; }

function credentialSecret() {
  const value = str(process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY);
  if (!value || value.length < 32) throw new Error("INTEGRATION_CREDENTIAL_ENCRYPTION_KEY must be at least 32 characters.");
  return value;
}
function credentialKey() { return crypto.createHash("sha256").update(credentialSecret()).digest(); }
function encryptCredential(raw) {
  const value = str(raw);
  if (!value) return { credentialCiphertext: "", credentialIv: "", credentialTag: "", credentialVersion: 1 };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", credentialKey(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    credentialCiphertext: body.toString("base64"),
    credentialIv: iv.toString("base64"),
    credentialTag: cipher.getAuthTag().toString("base64"),
    credentialVersion: 1,
  };
}
function decryptCredential(row = {}) {
  if (!row.credentialCiphertext) return "";
  if (Number(row.credentialVersion || 1) !== 1) throw new Error("Unsupported integration credential version.");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    credentialKey(),
    Buffer.from(String(row.credentialIv || ""), "base64"),
  );
  decipher.setAuthTag(Buffer.from(String(row.credentialTag || ""), "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(String(row.credentialCiphertext), "base64")),
    decipher.final(),
  ]).toString("utf8");
}
function maskCredential(row = {}) {
  if (!row.credentialCiphertext && !row.apiKey) return "";
  return "••••••••••••";
}

function ipv4Private(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
function ipv6Private(ip) {
  const v = ip.toLowerCase();
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || /^fe[89ab]/.test(v) || v.startsWith("ff") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.");
}
function isPrivateIp(ip) {
  const family = net.isIP(ip);
  if (family === 4) return ipv4Private(ip);
  if (family === 6) return ipv6Private(ip);
  return true;
}
function normalizeBaseUrl(raw) {
  const value = str(raw);
  if (!value) throw new Error("Base URL is required.");
  let url;
  try { url = new URL(value); } catch { throw new Error("Base URL must be a valid HTTP(S) URL."); }
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Only HTTP(S) integration URLs are allowed.");
  if (url.username || url.password) throw new Error("Credentials must not be embedded in the URL.");
  if (url.protocol !== "https:" && (isProduction() || process.env.ALLOW_INSECURE_INTEGRATION_HTTP !== "1")) {
    throw new Error("Integration base URLs must use HTTPS.");
  }
  url.hash = "";
  return url;
}
function buildProbeUrl(baseUrl, endpoint) {
  const base = normalizeBaseUrl(baseUrl);
  const ep = str(endpoint) || "/";
  let target;
  try { target = new URL(ep, base); } catch { throw new Error("Integration endpoint is invalid."); }
  if (target.origin !== base.origin) throw new Error("Integration endpoint must remain on the configured base origin.");
  if (target.username || target.password) throw new Error("Credentials must not be embedded in the endpoint.");
  return target;
}
async function assertSafeHost(url, lookup = dns.lookup) {
  const host = String(url.hostname || "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("Local integration targets are not allowed.");
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error("Private or reserved integration targets are not allowed.");
    return [{ address: host, family: net.isIP(host) }];
  }
  const rows = await lookup(host, { all: true, verbatim: true });
  const list = Array.isArray(rows) ? rows : [rows];
  if (!list.length || list.some((row) => isPrivateIp(String(row.address || "")))) throw new Error("Integration DNS resolved to a private or reserved address.");
  return list;
}
function authHeaders(row, credential) {
  const headers = { "User-Agent": "Classic-Academy-Integration-Probe/1.0", Accept: "application/json, text/plain;q=0.5, */*;q=0.1" };
  const type = str(row.authType || "None");
  if (!credential || type === "None") return headers;
  if (type === "API Key") headers["X-API-Key"] = credential;
  else if (type === "Bearer Token" || type === "OAuth2") headers.Authorization = `Bearer ${credential}`;
  else if (type === "Basic Auth") headers.Authorization = `Basic ${Buffer.from(credential, "utf8").toString("base64")}`;
  return headers;
}
async function probeIntegration(row, options = {}) {
  if (!row) throw new Error("Integration is required.");
  const target = buildProbeUrl(row.baseUrl, row.endpoint);
  const resolved = await assertSafeHost(target, options.lookup || dns.lookup);
  const credential = decryptCredential(row);
  const method = ["HEAD", "GET"].includes(str(row.testMethod).toUpperCase()) ? str(row.testMethod).toUpperCase() : "HEAD";
  const timeoutMs = Math.min(Math.max(Number(options.timeoutMs || 5000), 1000), 10000);
  const started = Date.now();
  const finish = (ok, statusCode, message) => ({
    ok,
    statusCode: Number(statusCode || 0),
    elapsedMs: Math.max(0, Date.now() - started),
    method,
    endpoint: `${target.origin}${target.pathname}`.slice(0, 500),
    message: str(message).slice(0, 220),
  });

  // Deterministic dependency injection for tests. Production uses a pinned socket below.
  if (options.fetchImpl) {
    try {
      const response = await options.fetchImpl(target, { method, headers: authHeaders(row, credential), redirect: "manual" });
      const statusCode = Number(response?.status || 0);
      const ok = statusCode >= 200 && statusCode < 300;
      return finish(ok, statusCode, ok ? `HTTP ${statusCode}` : `HTTP ${statusCode || "failure"}`);
    } catch (err) {
      return finish(false, 0, str(err?.message || "Connection failed"));
    }
  }

  const chosen = resolved[0];
  if (!chosen?.address || !chosen?.family) throw new Error("Integration target did not resolve to a usable public address.");
  const transport = target.protocol === "https:" ? https : http;
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    const request = transport.request(target, {
      method,
      headers: authHeaders(row, credential),
      servername: target.hostname,
      lookup(_hostname, _options, callback) {
        // Pin the exact public address that passed SSRF validation. This prevents DNS rebinding
        // between validation and the actual socket connection.
        callback(null, chosen.address, chosen.family);
      },
    }, (response) => {
      const statusCode = Number(response.statusCode || 0);
      response.resume();
      const ok = statusCode >= 200 && statusCode < 300;
      done(finish(ok, statusCode, ok ? `HTTP ${statusCode}` : `HTTP ${statusCode || "failure"}`));
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error("Probe timed out"), { code: "ETIMEDOUT" })));
    request.on("error", (err) => done(finish(false, 0, err?.code === "ETIMEDOUT" ? "Probe timed out" : str(err?.message || "Connection failed"))));
    request.end();
  });
}
function escapeRegex(value) { return str(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function nextAverage(oldAverage, oldCount, elapsedMs) {
  const count = Math.max(Number(oldCount || 0), 0);
  if (!count) return Math.round(elapsedMs);
  return Math.round(((Number(oldAverage || 0) * count) + Number(elapsedMs || 0)) / (count + 1));
}

module.exports = {
  encryptCredential,
  decryptCredential,
  maskCredential,
  isPrivateIp,
  normalizeBaseUrl,
  buildProbeUrl,
  assertSafeHost,
  probeIntegration,
  escapeRegex,
  nextAverage,
};
