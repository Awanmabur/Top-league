const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const bytes = (p) => fs.statSync(path.join(root, p)).size;

// Global HTTP/network performance.
test('compression wraps static delivery instead of running after it', () => {
  const s = read('src/index.js');
  const compression = s.indexOf('app.use(compression({');
  const staticMount = s.indexOf('express.static(path');
  assert.ok(compression >= 0 && staticMount > compression);
});

test('static service worker uses stale while revalidate and bounded navigation network wait', () => {
  const s = read('public/sw.js');
  assert.match(s, /CACHE_VERSION = "v3"/);
  assert.match(s, /staleWhileRevalidate/);
  assert.match(s, /AbortController/);
  assert.match(s, /3500/);
  assert.match(s, /PUBLIC_NAVIGATION_PATHS/);
  assert.match(s, /networkOnlyNavigation/);
  assert.match(s, /cache: "no-store"/);
  assert.doesNotMatch(s, /if \(request\.mode === "navigate"\) \{\s*event\.respondWith\(networkFirst\(request\)\)/);
});

test('mongo pool has bounded connecting and wait queue plus opt-in slow query telemetry', () => {
  const s = read('src/config/db.js');
  assert.match(s, /MONGO_MAX_CONNECTING/);
  assert.match(s, /maxConnecting/);
  assert.match(s, /MONGO_WAIT_QUEUE_TIMEOUT_MS/);
  assert.match(s, /waitQueueTimeoutMS/);
  assert.match(s, /DB_PERF_LOGS/);
  assert.match(s, /DB_SLOW_QUERY_MS/);
});

test('session touch writes are coalesced and platform activity writes are throttled', () => {
  const sessions = read('src/services/redisSessionStore.js');
  const guards = read('src/middleware/platform/guards.js');
  assert.match(sessions, /REDIS_SESSION_TOUCH_INTERVAL_SECONDS/);
  assert.match(sessions, /touchedAt/);
  assert.match(guards, /PLATFORM_ACTIVITY_WRITE_INTERVAL_MS/);
  assert.match(guards, /platformLastActivityAt/);
});

test('platform route permission guards reuse same-request validated authority only', () => {
  const s = read('src/middleware/platform/guards.js');
  assert.match(s, /req\._platformAuthorityLoaded = true/);
  assert.ok((s.match(/req\._platformAuthorityLoaded && req\.user && req\.platformAccess/g) || []).length >= 2);
});

test('marketing pages receive bounded shared-cache headers', () => {
  const s = read('src/routes/platform/pages.js');
  assert.match(s, /s-maxage=3600/);
  assert.match(s, /stale-while-revalidate=86400/);
});

test('security response headers include a restrictive Permissions Policy', () => {
  const s = read('src/index.js');
  assert.match(s, /Permissions-Policy/);
  assert.match(s, /camera=\(\)/);
  assert.match(s, /microphone=\(\)/);
  assert.match(s, /X-Permitted-Cross-Domain-Policies/);
  assert.match(read('src/middleware/security/requestHardening.js'), /sec-fetch-site/);
  assert.match(read('src/middleware/security/requestHardening.js'), /cross-site/);
});

// Request/query performance.
test('student documents page performs no migration work and groups KPI counts', () => {
  const s = read('src/controllers/tenant/admin/studentDocsController.js');
  assert.doesNotMatch(s, /ensureStudentDocsFromApplicants/);
  assert.match(s, /StudentDoc\.aggregate/);
  assert.ok((s.match(/\.countDocuments\(/g) || []).length <= 1);
});

test('users attendance and assets controllers aggregate dashboard KPIs', () => {
  assert.match(read('src/controllers/tenant/admin/usersController.js'), /\.aggregate\(/);
  assert.match(read('src/controllers/tenant/admin/attendanceController.js'), /\.aggregate\(/);
  assert.match(read('src/controllers/tenant/admin/assetsController.js'), /\.aggregate\(/);
});

test('public school profile independent data reads run concurrently', () => {
  const s = read('src/controllers/platform/schoolsPublicController.js');
  assert.match(s, /Promise\.all\(\[/);
  assert.match(s, /computeCounts/);
  assert.match(s, /loadSubjects/);
  assert.match(s, /SchoolFAQ/);
  assert.match(s, /SchoolReview/);
});

// Marketing images.
test('optimized local WebP marketing assets are present and materially smaller than originals', () => {
  const pairs = [
    ['public/img/hero.webp', 'public/img/hero.png'],
    ['public/img/feature.webp', 'public/img/feature.png'],
    ['public/img/about.webp', 'public/img/about.png'],
    ['public/img/academylogo.webp', 'public/img/academylogo.png'],
  ];
  for (const [optimized, original] of pairs) {
    assert.ok(fs.existsSync(path.join(root, optimized)), optimized);
    assert.ok(bytes(optimized) < bytes(original), `${optimized} should be smaller than ${original}`);
  }
});

test('approved public imagery preserves distinct sources and exact main-page store badges', () => {
  const dir = path.join(root, 'views/platform/public');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ejs'));
  let combined = '';
  for (const file of files) {
    const view = read(`views/platform/public/${file}`);
    combined += view + '\n';
    assert.doesNotMatch(view, /\/js\/public-image-fallback\.js/, `${file} must not install a generic marketing-image fallback`);
  }
  assert.match(combined, /picsum\.photos/i);
  assert.match(combined, /img\.icons8\.com/i);

  const features = read('public/pages/features.js');
  for (const seed of ['finance-ca','exams-ca','attendance-ca','communication-ca','portal-ca','reports-ca','security-ca','core-ca']) {
    assert.match(features, new RegExp(`picsum\\.photos/seed/${seed}/1200/700`));
  }
  assert.equal((features.match(/\/img\/feature\.(?:png|webp)/g) || []).length, 0, 'feature panels must not all reuse the Key Features image');

  for (const file of ['public/pages/blog.js', 'public/js/blog.js']) {
    const blog = read(file);
    assert.match(blog, /picsum\.photos\/seed\/admissions\/1200\/700/);
    assert.match(blog, /picsum\.photos\/seed\/finance\/1200\/700/);
    assert.match(blog, /picsum\.photos\/seed\/exams\/1200\/700/);
  }

  const footer = read('views/platform/partials/footer.ejs');
  const google = 'https://upload.wikimedia.org/wikipedia/commons/7/78/Google_Play_Store_badge_EN.svg';
  const apple = 'https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg';
  assert.match(footer, new RegExp(google.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')));
  assert.match(footer, new RegExp(apple.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')));
  assert.ok(footer.indexOf(google) < footer.indexOf(apple), 'Google Play badge must appear immediately before Apple badge as approved');
  assert.match(footer, /style="height: 50px; width: 150px" alt="Google Play"/);
  assert.match(footer, /alt="Download on the App Store" style="height: 50px;"/);
  assert.doesNotMatch(footer, /store-link|google-play-badge|app-store-badge/);
});

test('approved testimonial imagery is not replaced with a generic Academy logo fallback', () => {
  const css = read('public/css/style.css');
  for (const host of ['w7.pngwing.com', 'encrypted-tbn0.gstatic.com', 'png.pngtree.com']) {
    assert.match(css, new RegExp(host.replace(/\\./g, '\\\\.') + '[^;]*;'));
  }
  assert.doesNotMatch(css, /background-image:[^;]+academylogo\.(?:webp|png)/);
});

test('public school/search controllers preserve the approved distinct fallback imagery', () => {
  const schools = read('src/controllers/platform/schoolsPublicController.js');
  const search = read('src/controllers/platform/publicSearchController.js');
  assert.match(schools, /images\.unsplash\.com\/photo-1580582932707-520aed937b7b/);
  assert.match(search, /picsum\.photos\/seed\/search-school\/1200\/700/);
  assert.doesNotMatch(`${schools}\n${search}`, /\/img\/feature\.(?:webp|png)/);
});

// Durable Google Calendar OAuth.
test('Google Calendar refresh credential is encrypted at rest and never a plaintext model field', () => {
  const model = read('src/models/platform/PlatformIntegrationCredential.js');
  assert.match(model, /credentialCiphertext: \{[^\n]*select: false/);
  assert.match(model, /credentialIv: \{[^\n]*select: false/);
  assert.match(model, /credentialTag: \{[^\n]*select: false/);
  assert.doesNotMatch(model, /refreshToken\s*:/);
  assert.match(model, /uniq_platform_integration_provider/);
});

test('Google Calendar OAuth uses PKCE state validation, minimal scopes and encrypted persistence', () => {
  const s = read('src/services/googleCalendarAuthService.js');
  assert.match(s, /calendar\.events\.owned/);
  assert.match(s, /calendar\.events\.freebusy/);
  assert.match(s, /code_challenge_method: "S256"/);
  assert.match(s, /timingSafeEqual/);
  assert.match(s, /encryptCredential/);
  assert.match(s, /decryptCredential/);
  assert.match(s, /invalid_grant/);
  assert.match(s, /reconnect_required/);
  assert.match(s, /cachedCalendarClient/);
  assert.match(s, /eagerRefreshThresholdMillis/);
  assert.match(s, /SERVICE_ACCOUNT_SCOPES/);
  assert.match(s, /google\.auth\.JWT/);
  assert.match(s, /GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_B64/);
  assert.match(s, /GOOGLE_SERVICE_ACCOUNT_SUBJECT/);
});

test('Workspace service-account mode keeps private keys out of Mongo and uses delegated JWT auth', () => {
  const auth = read('src/services/googleCalendarAuthService.js');
  const model = read('src/models/platform/PlatformIntegrationCredential.js');
  assert.match(auth, /GOOGLE_CALENDAR_AUTH_MODE/);
  assert.match(auth, /new google\.auth\.JWT/);
  assert.match(auth, /subject:\s*str\(process\.env\.GOOGLE_SERVICE_ACCOUNT_SUBJECT\)/);
  assert.match(auth, /SERVICE_ACCOUNT_SCOPES/);
  assert.match(model, /service_account/);
  assert.doesNotMatch(model, /PRIVATE_KEY|privateKey|serviceAccountPrivate/i);
  assert.match(auth, /credentialCiphertext:\s*""/);
});

test('booking uses the authenticated Google client calendar id in both OAuth and service-account modes', () => {
  const booking = read('src/controllers/platform/bookingController.js');
  assert.match(booking, /googleCalendar\.configured\(\)/);
  assert.match(booking, /freeBusyBetween\(googleClient/);
  assert.match(booking, /items:\s*\[\{ id: googleClient\.calendarId \}\]/);
  assert.match(booking, /calendarId:\s*googleClient\.calendarId/);
  assert.match(booking, /normalizeCalendarError\(error, googleClient\.credentialId\)/);
});

test('legacy Google env refresh token is migration-only and booking runtime uses durable credential service', () => {
  const auth = read('src/services/googleCalendarAuthService.js');
  const booking = read('src/controllers/platform/bookingController.js');
  assert.match(auth, /importLegacyEnvRefreshToken/);
  assert.match(auth, /source: "legacy_env"/);
  assert.doesNotMatch(booking, /GOOGLE_OAUTH_REFRESH_TOKEN/);
  assert.match(booking, /googleCalendar\.getCalendarClient\(\)/);
  assert.match(booking, /GOOGLE_CALENDAR_RECONNECT_REQUIRED/);
});

test('Super Admin has real Google Calendar connect callback test and disconnect lifecycle', () => {
  const routes = read('src/routes/platform/settings.js');
  const view = read('views/platform/settings/index.ejs');
  for (const endpoint of ['google-calendar/connect', 'google-calendar/callback', 'google-calendar/test', 'google-calendar/disconnect']) {
    assert.match(routes, new RegExp(endpoint.replace('/', '\\/')));
  }
  assert.match(routes, /platformRequire\("settings\.manage"\)/);
  assert.match(routes, /router\.get\("\/super-admin\/settings\/google-calendar\/connect"/);
  assert.match(view, /Google Calendar Booking/);
  assert.match(view, /href="\/super-admin\/settings\/google-calendar\/connect"/);
  assert.match(view, /name="_csrf"/);
});

test('production readiness requires an explicit Google auth mode and never requires a static refresh token', () => {
  const s = read('src/config/productionReadiness.js');
  assert.match(s, /GOOGLE_CALENDAR_AUTH_MODE/);
  assert.match(s, /GOOGLE_OAUTH_CLIENT_ID/);
  assert.match(s, /GOOGLE_OAUTH_CLIENT_SECRET/);
  assert.match(s, /GOOGLE_OAUTH_REDIRECT_URI/);
  assert.match(s, /GOOGLE_SERVICE_ACCOUNT_EMAIL/);
  assert.match(s, /GOOGLE_SERVICE_ACCOUNT_SUBJECT/);
  assert.match(s, /GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_B64/);
  assert.doesNotMatch(s, /requireEnv\([^\n]*GOOGLE_OAUTH_REFRESH_TOKEN/);
  assert.match(s, /legacy bootstrap|one-time migration/);
  assert.match(s, /GOOGLE_OAUTH_CONSENT_STATUS/);
  assert.match(s, /production.*internal|internal.*production/i);
});

// Backup SSRF / artifact integrity.
test('backup restore/download refuses legacy stored URLs and uses bounded authenticated artifact fetch', () => {
  const s = read('src/controllers/tenant/admin/backupController.js');
  assert.match(s, /accessType!?={0,2}[\"']authenticated[\"']/);
  assert.match(s, /filePublicId/);
  assert.match(s, /redirect:\s*[\"']error[\"']/);
  assert.match(s, /AbortSignal\.timeout\(15(?:_?000)\)/);
  assert.match(s, /getReader\(\)/);
  assert.match(s, /maxBytes=150\*1024\*1024/);
  assert.doesNotMatch(s, /fetch\(job\.filePath/);
});

test('backup migration quarantines completed legacy URL-only artifacts', () => {
  const s = read('scripts/lib/migrateBackups.js');
  assert.match(s, /filePublicId/);
  assert.match(s, /migrationQuarantinedAt/);
  assert.match(s, /set\.status=[\"']Failed[\"']/);
});


test('ordinary dynamic requests avoid Redis global limiter while abuse-sensitive routes keep distributed stores', () => {
  const index = read('src/index.js');
  const booking = read('src/routes/platform/booking.js');
  const bookingController = read('src/controllers/platform/bookingController.js');
  const tenantLimits = read('src/middleware/tenant/rateLimiters.js');
  assert.doesNotMatch(index, /classic-academy:rl:global/);
  assert.match(index, /app\.use\(\s*rateLimit\(\{/);
  assert.match(booking, /bookingApiLimiter/);
  assert.match(bookingController, /redisRateLimitOptions\("booking-api"\)/);
  assert.match(tenantLimits, /redisRateLimitOptions/);
});

test('session middleware does not refresh cookies and Redis TTL on every response', () => {
  const index = read('src/index.js');
  assert.ok((index.match(/rolling:\s*false/g) || []).length >= 2);
  assert.doesNotMatch(index, /rolling:\s*true/);
});

test('multipart upload parsers bound files fields parts nesting and reject unsafe CSV types', () => {
  const csv = read('src/middleware/csvUpload.js');
  assert.match(csv, /files:\s*1/);
  assert.match(csv, /fields:\s*10/);
  assert.match(csv, /parts:\s*11/);
  assert.match(csv, /fieldNestingDepth:\s*2/);
  assert.match(csv, /headerPairs:\s*100/);
  assert.match(csv, /Only CSV files are allowed/);
  assert.match(csv, /TextDecoder\("utf-8", \{ fatal: true \}\)/);

  const targets = [
    'src/routes/tenant/admin/students.js',
    'src/routes/tenant/admin/timetable.js',
    'src/routes/tenant/admin/parents.js',
    'src/routes/tenant/admin/results.js',
    'src/routes/tenant/admin/assignments.js',
    'src/routes/tenant/admin/reports.js',
    'src/routes/tenant/admin/notifications.js',
    'src/routes/tenant/admin/attendance.js',
    'src/routes/tenant/admin/academicCalendar.js',
  ];
  for (const target of targets) {
    const src = read(target);
    assert.match(src, /createCsvUpload/);
    assert.match(src, /validateCsvUpload/);
  }
  for (const target of ['src/middleware/uploadMemory.js','src/utils/uploadMemory.js','src/middleware/uploads/schoolProfileMulter.js']) {
    const src = read(target);
    assert.match(src, /fields:/);
    assert.match(src, /parts:/);
    assert.match(src, /fieldNestingDepth:/);
    assert.match(src, /headerPairs:/);
  }
});

test('high-traffic catalog pages batch KPI work instead of serial status counts', () => {
  for (const target of [
    'src/controllers/tenant/admin/classesController.js',
    'src/controllers/tenant/admin/sectionsController.js',
    'src/controllers/tenant/admin/streamsController.js',
    'src/controllers/tenant/admin/subjectsController.js',
    'src/controllers/tenant/admin/parentsController.js',
    'src/controllers/tenant/admin/timetableController.js',
    'src/controllers/tenant/admin/resultsController.js',
    'src/controllers/tenant/admin/transcriptsController.js',
  ]) {
    const src = read(target);
    assert.match(src, /statusRows|statusCounts/);
    assert.match(src, /aggregate\(\[/);
  }
  assert.match(read('src/controllers/tenant/admin/facilitiesController.js'), /Promise\.all\(\[/);
});


test('request parsing and redirect boundaries reject broad parser and referer-host abuse', () => {
  const index = read('src/index.js');
  assert.match(index, /parameterLimit:\s*500/);
  assert.match(index, /depth:\s*5/);
  assert.match(index, /safeRequestAuthority/);
  assert.match(index, /res\.redirect\(308, `https:\/\//);
  const combined = [
    read('src/controllers/tenant/admin/studentsController.js'),
    read('src/controllers/tenant/admin/parentsController.js'),
  ].join('\n');
  assert.doesNotMatch(combined, /redirect\(["']back["']\)/);
});

test('tenant host resolution relies on Express trusted-proxy hostname instead of raw forwarded-host', () => {
  for (const target of [
    'src/middleware/tenant/tenantResolver.js',
    'src/middleware/tenant/resolveTenantAccess.js',
  ]) {
    const src = read(target);
    assert.match(src, /req\.hostname/);
    assert.doesNotMatch(src, /headers\[["']x-forwarded-host["']\]/);
  }
});

test('buffered document/image uploads validate magic bytes, MIME-extension agreement and image dimensions', () => {
  const s = read('src/middleware/validateBufferedUploads.js');
  assert.match(s, /%PDF-/);
  assert.match(s, /RIFF/);
  assert.match(s, /WEBP/);
  assert.match(s, /readUInt32BE/);
  assert.match(s, /maxImagePixels/);
  assert.match(s, /extension, MIME type, and file content do not match/);
  for (const target of [
    'src/routes/tenant/public/admissions.js',
    'src/routes/tenant/public/scholarships.js',
    'src/routes/tenant/admin/students.js',
    'src/routes/tenant/admin/admissions.js',
    'src/routes/tenant/admin/discipline.js',
    'src/routes/tenant/admin/studentDocs.js',
    'src/routes/tenant/admin/profile.js',
  ]) assert.match(read(target), /validateBufferedUploads/);
});

test('Admissions document uploads and CSV imports use separate constrained parsers', () => {
  const s = read('src/routes/tenant/admin/admissions.js');
  assert.match(s, /createCsvUpload/);
  assert.match(s, /validateCsvUpload/);
  assert.match(s, /const csvUpload = createCsvUpload/);
  assert.match(s, /applicants\/import", csvUpload\.single\("file"\), validateCsvUpload/);
  assert.match(s, /intakes\/import", csvUpload\.single\("file"\), validateCsvUpload/);
  assert.match(s, /requirements\/import", csvUpload\.single\("file"\), validateCsvUpload/);
  assert.match(s, /documents\/upload", upload\.single\("file"\), validateDocs/);
});


test('HTTP server and query parser bound slow-client and nested-query resource abuse', () => {
  const index = read('src/index.js');
  assert.match(index, /app\.set\("query parser", "simple"\)/);
  assert.match(index, /server\.requestTimeout = boundedHttpInt/);
  assert.match(index, /server\.headersTimeout = Math\.min/);
  assert.match(index, /server\.keepAliveTimeout = boundedHttpInt/);
  assert.match(index, /server\.maxRequestsPerSocket = boundedHttpInt/);
  assert.match(index, /server\.maxHeadersCount = boundedHttpInt/);
  assert.match(index, /"frame-src": \["'self'", "https:\/\/www\.google\.com"\]/);
});

test('tenant database connection failures have short circuit backoff and idle pool cleanup', () => {
  const db = read('src/config/db.js');
  assert.match(db, /maxIdleTimeMS/);
  assert.match(db, /TENANT_FAILURES/);
  assert.match(db, /TENANT_CONNECT_FAILURE_BACKOFF_MS/);
  assert.match(db, /Tenant database connection is temporarily unavailable/);
});

test('tenant authorization collapses user profile and role lifecycle checks into one live aggregate in production', () => {
  const auth = read('src/middleware/tenant/requireTenantAuth.js');
  assert.match(auth, /async function loadLiveAuthority/);
  assert.match(auth, /User\.aggregate\(\[/);
  assert.match(auth, /from: Student\.collection\.name/);
  assert.match(auth, /from: Parent\.collection\.name/);
  assert.match(auth, /from: Staff\.collection\.name/);
  assert.match(auth, /from: StaffRole\.collection\.name/);
  assert.match(auth, /process\.env\.NODE_ENV !== "production"/);
  assert.match(auth, /live authority aggregate/);
  assert.doesNotMatch(auth, /USER_CACHE_TTL_MS = 60 \* 1000/);
});

test('multipart buffering has a request-wide memory ceiling and clean upload error statuses', () => {
  const bounded = read('src/middleware/boundedMemoryStorage.js');
  const handler = read('src/middleware/tenant/errorHandler.js');
  assert.match(bounded, /LIMIT_TOTAL_FILE_SIZE/);
  assert.match(bounded, /aggregateLimit/);
  assert.match(handler, /LIMIT_TOTAL_FILE_SIZE/);
  assert.match(handler, /uploadTooLarge/);
  for (const target of [
    'src/middleware/uploadMemory.js',
    'src/utils/uploadMemory.js',
    'src/middleware/uploads/schoolProfileMulter.js',
    'src/middleware/csvUpload.js',
  ]) assert.match(read(target), /boundedMemoryStorage/);
});

test('marketing testimonial slider is self-hosted and non-fatal', () => {
  for (const target of [
    'views/platform/public/index.ejs',
    'views/platform/public/about.ejs',
    'views/platform/public/admissions.ejs',
    'views/platform/public/plan.ejs',
    'views/platform/public/benefits.ejs',
  ]) {
    const view = read(target);
    assert.match(view, /<script defer src="\/vendor\/swiper\/swiper-bundle\.min\.js"><\/script>/);
    assert.match(view, /\/vendor\/swiper\/swiper-bundle\.min\.css/);
    assert.doesNotMatch(view, /cdn\.jsdelivr\.net/);
    assert.match(view, /preconnect[^>]+cdnjs\.cloudflare\.com/);
  }
  assert.ok(fs.existsSync(path.join(root, 'public/vendor/swiper/swiper-bundle.min.js')));
  assert.ok(fs.existsSync(path.join(root, 'public/vendor/swiper/swiper-bundle.min.css')));
  assert.match(read('public/vendor/swiper/swiper-bundle.min.js'), /window\.Swiper/);
  assert.doesNotMatch(read('src/index.js'), /cdn\.jsdelivr\.net/);
  const features = read('views/platform/public/features.ejs');
  assert.doesNotMatch(features, /swiper-bundle/);
  for (const target of ['public/js/public.js','public/pages/about.js','public/pages/admissions.js','public/pages/benefits.js','public/pages/plan.js']) {
    assert.match(read(target), /window\.Swiper/);
  }
});

test('Google booking health exposes consent mode and warns against testing credentials', () => {
  const service = read('src/services/googleCalendarAuthService.js');
  const view = read('views/platform/settings/index.ejs');
  assert.match(service, /GOOGLE_OAUTH_CONSENT_STATUS/);
  assert.match(service, /durableConsent/);
  assert.match(view, /OAuth consent mode/);
  assert.match(view, /Workspace service account/);
  assert.match(view, /domain-wide delegation/);
  assert.match(view, /Testing-mode credentials are not suitable for live booking/);
});

test('platform reporting summary is computed in Mongo rather than materializing every payment and subscription', () => {
  const reports = read('src/controllers/platform/reportsController.js');
  assert.match(reports, /function reportSummaryAggregates/);
  assert.match(reports, /PlatformSubscription\.aggregate/);
  assert.match(reports, /PlatformPayment\.aggregate/);
  assert.match(reports, /\$switch/);
  assert.match(reports, /\$group/);
});

test('inline scripts and style blocks are nonce-bound while style attributes keep narrow compatibility', () => {
  const viewsRoot = path.join(root, 'views');
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.ejs')) files.push(full);
    }
  };
  walk(viewsRoot);
  for (const file of files) {
    const view = fs.readFileSync(file, 'utf8');
    for (const match of view.matchAll(/<script\b([^>]*)>/gi)) {
      const attrs = match[1].toLowerCase();
      if (!attrs.includes('src=')) assert.match(attrs, /nonce=/, file);
    }
    for (const match of view.matchAll(/<style\b([^>]*)>/gi)) {
      assert.match(match[1].toLowerCase(), /nonce=/, file);
    }
  }
  const index = read('src/index.js');
  assert.match(index, /"style-src-elem"/);
  assert.match(index, /"style-src-attr": \["'unsafe-inline'"\]/);
  assert.match(index, /nonce-\$\{res\.locals\.cspNonce\}/);
});

test('Exams page removes serial catalog/KPI waterfall', () => {
  const exams = read('src/controllers/tenant/admin/examsController.js');
  assert.match(exams, /const \[total, classes, subjects, staffList, kpis, scopeLists\] = await Promise\.all\(\[/);
  assert.match(exams, /Exam\.countDocuments\(filter\)/);
  assert.match(exams, /buildKpis\(Exam, filter\)/);
});

test('attendance sheet removes per-student read and notification N+1 work', () => {
  const attendance = read('src/controllers/tenant/admin/attendanceController.js');
  assert.match(attendance, /existingRows=await Attendance\.find\(\{student:\{\$in:/);
  assert.match(attendance, /runBounded\(prepared,8/);
  assert.match(attendance, /syncAttendanceAlertsBatch/);
  assert.match(attendance, /Notification\.bulkWrite\(ops,\{ordered:false\}\)/);
  assert.match(attendance, /Parent\.find\(\{childrenStudentIds:\{\$in:studentIds\}/);
});

test('public links opening new tabs cannot control the opener window', () => {
  const viewsRoot = path.join(root, 'views');
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.ejs')) files.push(full);
    }
  };
  walk(viewsRoot);
  for (const file of files) {
    const view = fs.readFileSync(file, 'utf8');
    // Strip EJS delimiters before parsing tag text so the `%>` token inside a
    // dynamic href cannot be mistaken for the HTML tag's closing `>`.
    const htmlShape = view.replace(/<%[\s\S]*?%>/g, 'EJS');
    for (const match of htmlShape.matchAll(/<a\b([^>]*\btarget=["']_blank["'][^>]*)>/gi)) {
      assert.match(match[1], /\brel=["'][^"']*\bnoopener\b[^"']*["']/i, file);
    }
  }
});

test('high-risk EJS attributes and bootstrap JSON use escaped output', () => {
  const profile = read('views/tenant/profile/index.ejs');
  const schoolProfile = read('views/tenant/settings/school-profile.ejs');
  const users = read('views/tenant/staff/users.ejs');
  const students = read('views/tenant/students/index.ejs');
  const roles = read('views/tenant/roles/index.ejs');
  assert.doesNotMatch(profile, /data-q="<%-/);
  assert.doesNotMatch(profile, /data-a="<%-/);
  assert.doesNotMatch(schoolProfile, /data-q="<%-/);
  assert.doesNotMatch(schoolProfile, /data-a="<%-/);
  assert.ok(users.includes('replace(/</g,"\\u003c")'));
  assert.doesNotMatch(students, /data-default-options='<%-/);
  assert.ok(roles.includes('replace(/</g,"\\u003c")'));
});

test('school public cover preserves the approved school-specific media behavior', () => {
  const client = read('public/js/school-profile-public.js');
  assert.ok(client.includes('const url = (cover.dataset.coverUrl || "").trim();'));
  assert.match(client, /if \(!url\) return/);
  assert.match(client, /cover\.style\.setProperty\(\"--cover-url\"/);
  assert.doesNotMatch(client, /fallbackUrl|\/img\/(?:hero|feature)\.(?:webp|png)/);
});

test('tenant invite links use canonical tenant authority rather than forwarded host headers', () => {
  const invite = read('src/utils/inviteService.js');
  assert.match(invite, /canonicalTenantBaseUrl/);
  assert.match(invite, /tenant\.customDomain/);
  assert.match(invite, /tenant\.subdomain/);
  assert.match(invite, /BASE_DOMAIN/);
  assert.doesNotMatch(invite, /x-forwarded-host/i);
  assert.doesNotMatch(invite, /req\.get\(["']host["']\)/);
  assert.match(invite, /Production invite links require HTTPS/);
});

test('tenant login never reflects internal exception text to unauthenticated users', () => {
  const auth = read('src/controllers/tenant/tenant/authController.js');
  assert.match(auth, /console\.error\("Tenant login error:", err\)/);
  assert.match(auth, /Unable to sign in right now\. Please try again\./);
  assert.doesNotMatch(auth, /renderLogin\(req, res, 500, \{ error: err\?\.message/);
});

test('live backup path uses asynchronous compression and bounded parallel database reads', () => {
  const service = read('src/services/tenant/backupService.js');
  const controller = read('src/controllers/tenant/admin/backupController.js');
  assert.match(service, /promisify\(zlib\.gzip\)/);
  assert.match(service, /packAsync/);
  assert.match(service, /unpackAsync/);
  assert.match(service, /BACKUP_QUERY_CONCURRENCY/);
  assert.match(service, /BACKUP_GZIP_LEVEL/);
  assert.match(controller, /await backup\.packAsync/);
  assert.match(controller, /await backup\.unpackAsync/);
  assert.doesNotMatch(controller, /backup\.pack\(/);
  assert.doesNotMatch(controller, /backup\.unpack\(/);
});

test('background work can run outside the web process and scheduler sweeps are staggered', () => {
  const index = read('src/index.js');
  const worker = read('src/scheduler.js');
  const timing = read('src/services/schedulerTiming.js');
  const backupScheduler = read('src/services/tenant/backupScheduler.js');
  const procfile = read('Procfile');
  assert.match(index, /shouldRunSchedulersInWeb\(\)/);
  assert.match(index, /Background schedulers: external worker mode/);
  assert.match(worker, /Classic Academy scheduler worker running/);
  assert.match(timing, /RUN_SCHEDULERS_IN_WEB/);
  assert.match(timing, /NODE_ENV[^\n]*production/);
  assert.match(procfile, /worker: node src\/scheduler\.js/);
  assert.match(backupScheduler, /BACKUP_SCHEDULER_INTERVAL_MS \|\| 300_000/);
  assert.match(backupScheduler, /BACKUP_SCHEDULER_MAX_JOBS_PER_SWEEP/);
  for (const target of [
    'src/services/tenant/announcementScheduler.js',
    'src/services/tenant/messageScheduler.js',
    'src/services/tenant/eventScheduler.js',
    'src/services/tenant/leaveScheduler.js',
    'src/services/tenant/backupScheduler.js',
    'src/services/platformSubscriptionScheduler.js',
  ]) assert.match(read(target), /initialDelayMs\(/, target);
});

test('above-fold marketing hero images preserve the approved PNG art while retaining preload priority', () => {
  for (const page of ['about','admissions','benefits','features']) {
    const view = read(`views/platform/public/${page}.ejs`);
    assert.match(view, /rel="preload" as="image" href="\/img\/hero\.png" fetchpriority="high"/);
    assert.match(view, /src="(?:\.\/)?img\/hero\.png"/);
  }
  for (const page of ['about','admissions','benefits']) {
    const view = read(`views/platform/public/${page}.ejs`);
    const remoteArt = [...view.matchAll(/<img[^>]+src="https:\/\/(?:picsum\.photos|img\.icons8\.com)[^"]+"[^>]*>/g)].map((m) => m[0]);
    assert.ok(remoteArt.length >= 1, `${page} should retain approved secondary artwork`);
  }
});

test('Redis isolates session, distributed rate-limit and best-effort cache sockets', () => {
  const redis = read('src/config/redis.js');
  const index = read('src/index.js');
  const rate = read('src/services/rateLimitStoreFactory.js');
  const guardCache = read('src/services/platformGuardCache.js');
  const tenantCache = read('src/services/platformTenantAccessCache.js');
  const publicCache = read('src/services/platformPublicCacheService.js');
  assert.match(redis, /const clients = new Map\(\)/);
  assert.match(redis, /\["session", "rate", "cache"\]/);
  assert.match(redis, /getRedisClient\(role = "session"\)/);
  assert.match(redis, /const roles = \["session", "rate", "cache"\]\.filter\(\(role\) => isRedisRoleEnabled\(role\)\)/);
  assert.match(redis, /roles\.map\(\(role\) => \[role, getRedisClient\(role\)\]\)/);
  assert.match(index, /getRedisClient\("session"\)/);
  assert.match(rate, /getRedisClient\("rate"\)/);
  for (const source of [guardCache, tenantCache, publicCache]) {
    assert.match(source, /getRedisClient\("cache"\)/);
  }
});

test('platform public origins never trust raw host headers in production', () => {
  const booking = read('src/controllers/platform/bookingController.js');
  const pages = read('src/routes/platform/pages.js');
  for (const source of [booking, pages]) {
    assert.match(source, /PUBLIC_SITE_URL/);
    assert.match(source, /PLATFORM_SITE_URL/);
    assert.match(source, /NODE_ENV === "production"/);
    assert.match(source, /req\.hostname/);
    assert.doesNotMatch(source, /x-forwarded-host/i);
  }
  assert.match(booking, /required for booking URLs in production/);
  assert.match(pages, /required for public metadata in production/);
});

test('bulk assignment and library actions batch related-row counts instead of per-row reads', () => {
  const assignments = read('src/controllers/tenant/admin/assignmentController.js');
  const library = read('src/controllers/tenant/admin/libraryController.js');
  assert.match(assignments, /const countMap=await submissionCounts\(AssignmentSubmission,rows\.map\(\(row\)=>row\._id\)\)/);
  assert.match(assignments, /submissionCounts/);
  assert.match(library, /LibraryLoan\.aggregate\(\[/);
  assert.match(library, /\$group/);
  assert.match(library, /activeLoanCounts/);
});

test('production enables compiled EJS view caching', () => {
  const index = read('src/index.js');
  assert.match(index, /app\.set\("view cache", isProd\)/);
});

test('tenant public school media preserves gallery placeholders and lazy real media without generic feature fallback', () => {
  const detail = read('views/tenant/public/schools/view.ejs');
  const canonical = read('views/tenant/public/schools/school-profile.ejs');
  const listing = read('views/tenant/public/schools/index.ejs');
  assert.match(detail, /data-src="<%= img %>"/);
  assert.match(detail, /src="<%= img %>"/);
  assert.doesNotMatch(detail, /img \|\| ['"]\/img\/feature/);
  assert.match(canonical, /loading="lazy" decoding="async"/);
  assert.match(listing, /loading="lazy" decoding="async"/);
});

test('unexpected server errors are logged but not reflected to public or portal users', () => {
  const admissions = read('src/controllers/tenant/public/admissionsController.js');
  const backup = read('src/controllers/tenant/admin/backupController.js');
  const dashboard = read('src/controllers/tenant/students/dashboardController.js');
  const library = read('src/controllers/tenant/students/libraryController.js');
  assert.match(admissions, /console\.error\("Draft upload error:", err\)/);
  assert.match(admissions, /message: "Upload failed"/);
  assert.doesNotMatch(admissions, /message: err\.message \|\| "Upload failed"/);
  assert.match(backup, /Backup download error/);
  assert.doesNotMatch(backup, /status\(500\)\.send\(err\.message\|\|'Download failed\.'\)/);
  assert.match(dashboard, /Student dashboard error/);
  assert.doesNotMatch(dashboard, /Failed to load dashboard: " \+ err\.message/);
  assert.match(library, /Student library error/);
});

test('Exam bulk lifecycle counts result dependencies in one aggregation instead of serial N+1 queries', () => {
  const service = read('src/services/tenant/examService.js');
  const controller = read('src/controllers/tenant/admin/examsController.js');
  assert.match(service, /async function countExamResultsMany/);
  assert.match(service, /Result\.aggregate\(\[/);
  assert.match(service, /\$group:\s*\{\s*_id:\s*"\$exam"/);
  assert.match(controller, /countExamResultsMany\(req\.models, exams\)/);
  assert.doesNotMatch(controller, /for \(const exam of exams\) counts\.set\([^\n]*await countExamResults/);
});

test('Production readiness requires an explicit scheduler deployment mode', () => {
  const readiness = read('src/config/productionReadiness.js');
  const scheduler = read('src/services/schedulerTiming.js');
  const procfile = read('Procfile');
  assert.match(readiness, /RUN_SCHEDULERS_IN_WEB/);
  assert.match(readiness, /explicitly true or false/);
  assert.match(readiness, /dedicated scheduler worker/);
  assert.match(scheduler, /NODE_ENV[^\n]*production/);
  assert.match(procfile, /worker:\s*node src\/scheduler\.js/);
});

test('message delivery collapses recipient stats and portal fan-out into aggregate and bulk database work', () => {
  const service = read('src/services/tenant/messageService.js');
  assert.match(service, /MessageRecipient\.aggregate\(\[/);
  assert.match(service, /Notification\.bulkWrite\(/);
  assert.match(service, /MessageRecipient\.updateMany\(/);
  assert.match(service, /MESSAGE_EMAIL_CONCURRENCY/);
  assert.match(service, /runBounded\(pending, concurrency/);
  assert.doesNotMatch(service, /\[recipients, delivered, opened, failed\] = await Promise\.all/);
});

test('event notification and view fan-out use bulk writes instead of per-event database waterfalls', () => {
  const service = read('src/services/tenant/eventService.js');
  assert.match(service, /portalRecipients[\s\S]{0,1600}Notification\.bulkWrite\(/);
  assert.match(service, /EventView\.bulkWrite\(/);
  assert.match(service, /Event\.bulkWrite\(/);
  assert.doesNotMatch(service, /for \(const eventId of[^\n]+\) \{\n\s+const result = await EventView\.updateOne/);
});

test('production Google booking cannot silently fall back to a manually pasted refresh token', () => {
  const auth = read('src/services/googleCalendarAuthService.js');
  const readiness = read('src/config/productionReadiness.js');
  assert.match(auth, /GOOGLE_OAUTH_ALLOW_LEGACY_BOOTSTRAP/);
  assert.match(auth, /if \(!allowLegacyBootstrap\) return null/);
  assert.match(readiness, /GOOGLE_OAUTH_REFRESH_TOKEN is not a production runtime credential/);
  assert.match(readiness, /controlled one-time migration/);
});


test('request hardening rejects Mongo selector and dotted-path keys before controllers see them', () => {
  const runtime = read('src/config/runtime.js');
  const middleware = read('src/middleware/security/requestHardening.js');
  assert.match(runtime, /raw\.startsWith\("\$"\)/);
  assert.match(runtime, /raw\.includes\("\."\)/);
  assert.match(middleware, /containers = \[req\.query, req\.body, req\.params\]/);
  assert.match(middleware, /Invalid request payload/);
});

test('Google Calendar authorization health is probed by the background scheduler rather than customer requests', () => {
  const health = read('src/services/googleCalendarHealthScheduler.js');
  const worker = read('src/scheduler.js');
  const index = read('src/index.js');
  assert.match(health, /6 \* 60 \* 60 \* 1000/);
  assert.match(health, /googleCalendar\.configured\(\)/);
  assert.match(health, /googleCalendar\.testConnection\(\)/);
  assert.match(health, /GOOGLE_CALENDAR_RECONNECT_REQUIRED/);
  assert.match(health, /timer\.unref/);
  assert.match(worker, /startGoogleCalendarHealthScheduler\(\)/);
  assert.match(worker, /stopGoogleCalendarHealthScheduler\(\)/);
  assert.match(index, /startGoogleCalendarHealthScheduler\(\)/);
});

test('release documents the durable Google OAuth and production performance/security operating contract', () => {
  const google = read('docs/GOOGLE_CALENDAR_PRODUCTION_SETUP.md');
  const ops = read('docs/PERFORMANCE_SECURITY_OPERATIONS.md');
  const runbook = read('docs/PRODUCTION_RELEASE_CANDIDATE.md');
  assert.match(google, /In Production/);
  assert.match(google, /GOOGLE_OAUTH_ALLOW_LEGACY_BOOTSTRAP/);
  assert.match(google, /calendar\.events\.owned/);
  assert.match(google, /calendar\.events\.freebusy/);
  assert.match(google, /service account/i);
  assert.match(google, /domain-wide delegation/i);
  assert.match(ops, /RUN_SCHEDULERS_IN_WEB=false/);
  assert.match(ops, /npm audit --omit=dev --audit-level=high/);
  assert.match(ops, /Mongo `\$` operator and dotted-path request-key rejection/);
  assert.match(runbook, /GOOGLE_CALENDAR_PRODUCTION_SETUP\.md/);
});


test('release gates scan all JavaScript, EJS views, static media and package hygiene', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['check:syntax'], 'node scripts/check-js-syntax.js');
  assert.equal(pkg.scripts['check:views'], 'node scripts/check-ejs-views.js');
  assert.equal(pkg.scripts['check:media'], 'node scripts/check-static-media.js');
  assert.equal(pkg.scripts['check:hygiene'], 'node scripts/check-release-hygiene.js');
  assert.equal(pkg.scripts['check:csrf'], 'node scripts/check-authenticated-form-csrf.js');
  assert.match(pkg.scripts['release:preflight'], /check:hygiene/);
  assert.match(pkg.scripts['release:preflight'], /check:syntax/);
  assert.match(pkg.scripts['release:preflight'], /check:views/);
  assert.match(pkg.scripts['release:preflight'], /check:media/);
  assert.match(pkg.scripts['release:preflight'], /check:csrf/);
  const media = read('scripts/check-static-media.js');
  assert.match(media, /malformed <img> tag/);
  assert.match(media, /remote marketing image/);
  const hygiene = read('scripts/check-release-hygiene.js');
  assert.match(hygiene, /PRIVATE KEY/);
});

test('booking CSP permits the approved main-footer badge hosts without broadening to arbitrary image origins', () => {
  const booking = read('src/controllers/platform/bookingController.js');
  assert.match(booking, /"img-src": \["'self'", "data:", "https:\/\/res\.cloudinary\.com", "https:\/\/upload\.wikimedia\.org", "https:\/\/developer\.apple\.com"\]/);
  assert.doesNotMatch(booking, /"img-src": \[[^\]]*"https:"/);
});


test('authenticated mutation forms carry CSRF tokens and parent notification links are same-origin only', () => {
  const csrfTargets = [
    'views/platform/announcements/index.ejs',
    'views/tenant/settings/school-profile.ejs',
    'views/tenant/users/new.ejs',
    'views/tenant/users/list.ejs',
    'views/parents/profile.ejs',
    'views/parents/notifications.ejs',
    'views/staff/profile.ejs',
  ];
  for (const target of csrfTargets) assert.match(read(target), /name="_csrf"/);
  const parentNotifications = read('src/controllers/tenant/parents/notificationsController.js');
  assert.match(parentNotifications, /safeActionUrl/);
  assert.match(parentNotifications, /raw\.startsWith\("\/"\).*?!raw\.startsWith\("\/\/"\)/);
  const gate = read('scripts/check-authenticated-form-csrf.js');
  assert.match(gate, /POST form is missing a CSRF token/);
});

test('platform announcement and billing tables paginate instead of materializing every row', () => {
  const announcements = read('src/controllers/platform/announcementsController.js');
  const billing = read('src/controllers/platform/billingController.js');
  assert.match(announcements, /pageSize = 100/);
  assert.match(announcements, /\.skip\(\(page - 1\) \* pageSize\)/);
  assert.match(announcements, /\.limit\(pageSize\)/);
  assert.match(announcements, /countDocuments\(\{\}\)/);
  assert.match(billing, /pageSize = 100/);
  assert.match(billing, /PlatformSubscription\.countDocuments/);
  assert.match(billing, /\.skip\(\(page - 1\) \* pageSize\)/);
  assert.match(billing, /\.limit\(pageSize\)/);
});


test('platform tenant and operator lists are paginated and do not materialize every account', () => {
  const tenants = read('src/controllers/platform/tenantsController.js');
  const users = read('src/controllers/platform/authController.js');
  const tenantView = read('views/platform/tenants/index.ejs');
  const userView = read('views/platform/auth/users.ejs');
  for (const source of [tenants, users]) {
    assert.match(source, /pageSize = 100/);
    assert.match(source, /\.skip\(\(page - 1\) \* pageSize\)/);
    assert.match(source, /\.limit\(pageSize\)/);
    assert.match(source, /countDocuments\(/);
  }
  assert.match(tenantView, /pagination\.total/);
  assert.match(userView, /pagination\.total/);
});

test('legacy browser table renderers escape payroll and staff-user database strings', () => {
  const payroll = read('public/js/staff-payroll.js');
  const users = read('public/js/staff-users.js');
  for (const source of [payroll, users]) {
    assert.match(source, /const escapeHtml =/);
  }
  assert.match(payroll, /escapeHtml\(x\.title/);
  assert.match(users, /escapeHtml\(u\.fullName/);
  assert.match(users, /escapeHtml\(r\)/);
});

test('unexpected portal rendering and finance errors are logged without reflecting exception messages', () => {
  const combined = [
    read('src/controllers/tenant/admin/studentStatementsController.js'),
    read('src/controllers/tenant/admin/leaveController.js'),
    read('src/controllers/tenant/admin/financeReportsController.js'),
    read('src/controllers/tenant/students/_helpers.js'),
    read('src/controllers/tenant/students/eventsController.js'),
    read('src/controllers/tenant/students/financeController.js'),
  ].join('\n');
  assert.doesNotMatch(combined, /Failed to load (?:events|finance|student statements|leave requests|finance reports)[^"']*\+\s*err\.message/);
  assert.doesNotMatch(combined, /Render failed:\s*\$\{err\.message\}/);
  assert.match(combined, /console\.error/);
});

test('high-growth tenant communications and inquiry histories are bounded and database-aggregated', () => {
  const announcements = read('src/controllers/tenant/admin/announcementsController.js');
  const messaging = read('src/controllers/tenant/admin/messagingController.js');
  const inquiries = read('src/controllers/tenant/admin/inquiriesController.js');
  for (const source of [announcements, messaging, inquiries]) {
    assert.match(source, /pageSize = 100/);
    assert.match(source, /\.skip\(\(page - 1\) \* pageSize\)/);
    assert.match(source, /\.limit\(pageSize\)/);
    assert.match(source, /countDocuments\(/);
    assert.match(source, /\.aggregate\(/);
  }
  assert.match(read('views/tenant/announcements/index.ejs'), /pagination\.total/);
  assert.match(read('views/tenant/messaging/index.ejs'), /pagination\.total/);
  assert.match(read('views/tenant/inquiries/index.ejs'), /pagination\.total/);
});

test('public and student 500 responses do not reflect raw exception messages', () => {
  const admissions = read('src/controllers/tenant/public/admissionsController.js');
  const notifications = read('src/controllers/tenant/students/notificationsController.js');
  assert.doesNotMatch(admissions, /general:\s*err\.message/);
  assert.doesNotMatch(notifications, /Failed to load notifications:\s*"?\s*\+\s*err\.message/);
  assert.match(admissions, /console\.error\("Application submit error:"/);
  assert.match(notifications, /console\.error\("Student notifications load error:"/);
});

test('admin payroll avoids loading all historical items and the unused entire staff collection', () => {
  const payroll = read('src/controllers/tenant/admin/payrollController.js');
  const view = read('views/tenant/staff/payroll.ejs');
  assert.match(payroll, /pageSize = 20/);
  assert.match(payroll, /PayrollItem\.find\(\{ payrollRunId: \{ \$in: runIds \}/);
  assert.match(payroll, /PayrollRun\.aggregate\(/);
  assert.match(payroll, /PayrollRun\.distinct\('year'/);
  assert.doesNotMatch(payroll, /Staff \? Staff\.find\(\{ isDeleted/);
  assert.match(payroll, /paginate: false, includeItems: false/);
  assert.match(view, /pagination\.total/);
  assert.match(view, /current page/);
});
