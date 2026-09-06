// Classic Academy service worker.
// Scope: caches the static app shell so previously-visited pages remain
// viewable offline, and replays the offline request queue (see
// /js/offline/queue.js) once connectivity returns via Background Sync.
importScripts("/js/offline/db.js", "/js/offline/queue.js");

const CACHE_VERSION = "v3";
const CACHE_NAME = `classic-academy-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  "/css/navbar.css",
  "/js/navbar.js",
  "/js/offline/db.js",
  "/js/offline/queue.js",
  "/js/offline/forms.js",
  "/img/academylogo.webp",
];

const STATIC_PATH_RE = /^\/(css|js|img|vendor|assets)\//;

// Only immutable/static marketing pages may be retained as navigation HTML.
// Authenticated dashboards, tenant pages, search, school profiles, booking and
// other operational routes are always network-only to prevent private/stale
// HTML from being replayed from Cache Storage after logout or role changes.
const PUBLIC_NAVIGATION_PATHS = new Set([
  "/",
  "/about",
  "/features",
  "/services",
  "/contact",
  "/plan",
  "/blog",
  "/careers",
  "/faq",
  "/privacy",
  "/terms",
  "/admissions",
  "/share",
  "/security",
  "/integrations",
  "/resources",
  "/docs",
  "/status",
]);

function mayCacheNavigation(url) {
  return PUBLIC_NAVIGATION_PATHS.has(url.pathname) && !url.search;
}

function responseIsCacheable(response) {
  if (!response || !response.ok) return false;
  const policy = String(response.headers.get("Cache-Control") || "").toLowerCase();
  return !policy.includes("no-store") && !policy.includes("private");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (STATIC_PATH_RE.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (request.mode === "navigate") {
    if (mayCacheNavigation(url)) {
      event.respondWith(networkFirstPublic(request));
    } else {
      event.respondWith(networkOnlyNavigation(request));
    }
  }
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  return (await refresh) || Response.error();
}

async function networkFirstPublic(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (responseIsCacheable(response)) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    clearTimeout(timer);
    const cached = await caches.match(request);
    if (cached) return cached;
    return caches.match("/offline.html");
  }
}

async function networkOnlyNavigation(request) {
  try {
    return await fetch(request, { cache: "no-store" });
  } catch (err) {
    return (await caches.match("/offline.html")) || Response.error();
  }
}

async function flushQueueAndNotify() {
  const result = await self.OfflineQueue.flush();
  const clientsList = await self.clients.matchAll({ type: "window" });
  clientsList.forEach((client) => client.postMessage({ type: "offline-queue-flushed", result }));
  return result;
}

self.addEventListener("sync", (event) => {
  if (event.tag === "flush-offline-queue") {
    event.waitUntil(flushQueueAndNotify());
  }
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "flush-offline-queue") {
    event.waitUntil(flushQueueAndNotify());
  }
});
