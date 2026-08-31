// Classic Academy service worker.
// Scope: caches the static app shell so previously-visited pages remain
// viewable offline, and replays the offline request queue (see
// /js/offline/queue.js) once connectivity returns via Background Sync.
importScripts("/js/offline/db.js", "/js/offline/queue.js");

const CACHE_VERSION = "v1";
const CACHE_NAME = `classic-academy-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  "/css/navbar.css",
  "/js/navbar.js",
  "/js/offline/db.js",
  "/js/offline/queue.js",
  "/js/offline/forms.js",
  "/img/academylogo.png",
];

const STATIC_PATH_RE = /^\/(css|js|img|vendor|assets)\//;

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
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return cached || Response.error();
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return caches.match("/offline.html");
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
