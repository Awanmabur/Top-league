"use strict";

function normalizeSiteUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function configuredKey() {
  const key = String(process.env.INDEXNOW_KEY || "").trim();
  return /^[A-Za-z0-9_-]{8,128}$/.test(key) ? key : "";
}

function sanitizeUrls(urls, host) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(urls) ? urls : []) {
    try {
      const url = new URL(String(value || ""));
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      if (url.host !== host) continue;
      url.hash = "";
      const normalized = url.toString();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
      if (out.length >= 10000) break;
    } catch {
      // Invalid URL: skip it rather than sending malformed IndexNow payloads.
    }
  }
  return out;
}

async function submitIndexNow({ siteUrl, urls, fetchImpl = global.fetch } = {}) {
  const key = configuredKey();
  const origin = normalizeSiteUrl(siteUrl);
  if (!key || !origin || typeof fetchImpl !== "function") {
    return { ok: false, skipped: true, reason: !key ? "INDEXNOW_KEY not configured" : "invalid site URL or fetch unavailable" };
  }

  const parsed = new URL(origin);
  const urlList = sanitizeUrls(urls, parsed.host);
  if (!urlList.length) return { ok: false, skipped: true, reason: "no same-host URLs to submit" };

  const endpoint = String(process.env.INDEXNOW_ENDPOINT || "https://api.indexnow.org/indexnow").trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(Math.max(Number(process.env.INDEXNOW_TIMEOUT_MS || 4000), 1000), 10000));
  timeout.unref?.();

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: parsed.host,
        key,
        keyLocation: `${origin}/indexnow-key.txt`,
        urlList,
      }),
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status, submitted: urlList.length };
  } catch (error) {
    return { ok: false, error: String(error?.message || error), submitted: 0 };
  } finally {
    clearTimeout(timeout);
  }
}

function submitIndexNowBestEffort(options) {
  return submitIndexNow(options).catch(() => ({ ok: false }));
}

module.exports = {
  configuredKey,
  normalizeSiteUrl,
  sanitizeUrls,
  submitIndexNow,
  submitIndexNowBestEffort,
};
