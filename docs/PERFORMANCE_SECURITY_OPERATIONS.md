# Classic Academy — Performance & Security Operations Contract

This document describes the runtime assumptions behind the production hardening release. Source optimizations do not compensate for a database, Redis service, or application instance deployed in a distant region.

## 1. Production topology

Place the following in the same geographic region whenever providers permit it:

- web application;
- scheduler worker;
- MongoDB Atlas cluster;
- managed Redis;
- primary Cloudinary delivery region/CDN path where applicable.

Cross-region database or Redis latency is paid repeatedly on dynamic requests and can dominate all application-level optimization.

Run Node **24.11.1** exactly.

Use at least two production processes when the deployment supports it:

- Web: `node src/index.js`
- Scheduler worker: `node src/scheduler.js`

Set `RUN_SCHEDULERS_IN_WEB=false` when the dedicated worker is actually provisioned. If a dedicated worker cannot be provisioned, explicitly set `RUN_SCHEDULERS_IN_WEB=true`. Production readiness rejects an unspecified scheduler mode so scheduled messages, events, backups, leave processing and subscription expiry cannot silently disappear.

## 2. HTTP delivery

The application provides:

- compression before static file handling;
- Brotli/gzip for compressible responses;
- ETags and Last-Modified handling;
- long-lived browser caching for stable media/vendor assets;
- shorter cache windows for unhashed application JS/CSS;
- shared-cache headers for public marketing pages;
- no-store semantics for authenticated/sensitive pages;
- production EJS compiled-view caching;
- request/header/keep-alive bounds against slow-client resource exhaustion;
- a bounded, flat query parser.

Put a modern CDN/reverse proxy in front of the app so `s-maxage` on public marketing pages is honored at the edge. The proxy must forward HTTPS correctly and must match the configured trusted-proxy setting.

## 3. Image/media delivery

Marketing-critical images are self-hosted WebP assets. Below-the-fold images use lazy loading and asynchronous decoding; above-the-fold hero media is preloaded/fetch-prioritized. Public pages have a local image fallback and do not rely on remote placeholder/avatar hosts.

Uploaded school media remains served through the approved media provider, with render-time URL validation and local fallback when a stored URL is unusable.

Do not replace local marketing images with random third-party image URLs. That recreates the blank-image and latency failure mode this release removes.

## 4. MongoDB

Keep Atlas close to the app and use production-size connection pools. The code bounds server selection, connect and wait-queue timeouts and reports optional slow-query telemetry.

After deployment/migration, run:

```bash
npm run indexes
```

The index reconciler preflights uniqueness before replacing stale legacy indexes. Do not run an unconditional `dropIndexes()` or `syncIndexes()` against production data.

For temporary diagnosis only:

- `DB_PERF_LOGS=1`
- `DB_SLOW_QUERY_MS=300`

Disable noisy diagnostic logging after the bottleneck is located.

## 5. Redis

Production Redis is mandatory for sessions, distributed high-risk rate limits and bounded shared caches. Use TLS when available and deploy Redis close to the web service.

Ordinary page traffic does not use a distributed global limiter, avoiding an unnecessary Redis network round trip. Login/auth, public inquiry, public review and booking abuse boundaries retain distributed Redis-backed rate limiting.

Session TTL touches are coalesced rather than rewriting the session on every response. Best-effort cache commands have a shorter budget than security-critical session commands and use independent Redis connections so a cache stall cannot queue behind session traffic.

## 6. Database/query behavior

High-traffic dashboards and catalogs use concurrent independent reads and grouped aggregations rather than serial count waterfalls. Large notification/event fan-out uses Mongo bulk writes. Background delivery work is kept out of the web process when the scheduler worker is enabled.

Avoid introducing controller code of this shape on read paths:

```text
for each row:
    await Model.find/count/update(...)
```

Batch with `$in`, `$group`, `bulkWrite`, or bounded concurrency according to lifecycle semantics.

## 7. Security boundaries

The release centrally enforces:

- production secret/configuration readiness;
- secure, HttpOnly, SameSite session cookies;
- CSRF protection for state-changing browser actions;
- same-origin/fetch-metadata checks;
- prototype-pollution, Mongo `$` operator and dotted-path request-key rejection;
- strict payload and multipart limits;
- upload MIME/extension/signature/image-dimension validation;
- strong Content Security Policy with nonces for executable inline blocks;
- clickjacking/base/object/form restrictions;
- Permissions-Policy restrictions;
- formula-safe CSV generation;
- safe redirects and production-origin construction;
- host/header poisoning checks;
- encrypted integration credentials;
- private authenticated backup artifacts with checksum/encryption validation;
- SSRF-safe backup and integration network behavior;
- no raw exception/provider bodies returned to public users;
- optimistic revisions/leases/transactions or compensation on critical mutations;
- tenant and role authorization before data expansion.

No source package can guarantee that every possible vulnerability is absent. Production still requires dependency audits, infrastructure patching, secret rotation, access review, monitoring, backups/restores, and periodic independent penetration testing.

## 8. Performance telemetry

For a short diagnostic window:

```text
PERF_LOGS=1
SLOW_REQUEST_MS=300
```

This logs requests that exceed the threshold. Do not enable verbose HTTP/debug logging permanently in production.

Use the resulting route names to distinguish:

- network/edge latency;
- Mongo latency;
- Redis latency;
- external integration latency;
- server-side rendering/workload latency.

Browser DevTools should also be used to inspect TTFB, transfer size, cache hits, image decoding and third-party font/icon delays.

## 9. Release gate

From an exact clean production package under Node 24.11.1:

```bash
npm ci
npm audit --omit=dev --audit-level=high
npm run release:readiness
npm run indexes
npm test
npm run check
```

Do not call the release final if any gate fails or cannot be executed. A network failure reaching the npm registry is not evidence of a clean audit; repeat the audit when registry access is available.

### Development Redis isolation

In development, `REDIS_URL` alone no longer enables Redis traffic. This prevents a remote or unstable Redis service from slowing local page loads. Enable only the role you are actively testing:

```env
USE_REDIS_SESSIONS=1
USE_REDIS_RATE_LIMITS=1
USE_REDIS_CACHE=1
```

Production ignores these opt-in flags and enables the required Redis roles. Active Redis connections also send a bounded heartbeat to reduce provider idle disconnects.

Both `npm run release:readiness` and the compatibility alias `npm run check:production-readiness` run the production-readiness gate.
