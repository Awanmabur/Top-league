const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('canonical models carry revision and soft-delete lifecycle',()=>{
  const faq=read('src/models/tenant/SchoolFAQ.js'); const review=read('src/models/tenant/SchoolReview.js');
  for (const src of [faq,review]) { assert.match(src,/revision/); assert.match(src,/isDeleted/); assert.match(src,/deletedAt/); }
});

test('tenant profile is a unique singleton',()=>{
  const src=read('src/models/tenant/TenantProfile.js'); assert.match(src,/singletonKey/); assert.match(src,/uniq_tenant_profile_singleton/); assert.match(src,/unique:\s*true/);
});

test('public review endpoints use canonical service not embedded push',()=>{
  for (const f of ['src/controllers/tenant/public/schoolProfilePublicController.js','src/controllers/platform/schoolsPublicController.js']) {
    const src=read(f); assert.match(src,/submitCanonicalReview/); assert.doesNotMatch(src,/profile\.reviews\.push/);
  }
});

test('public pages prefer canonical FAQ/review content when tenant DB is available',()=>{
  for (const f of ['src/controllers/tenant/public/schoolProfilePublicController.js','src/controllers/platform/schoolsPublicController.js']) {
    const src=read(f); assert.match(src,/publicCanonicalContent/); assert.match(src,/TenantProfile/);
  }
});

test('admin moderation uses compare-and-set revisions and soft delete',()=>{
  const src=read('src/controllers/tenant/admin/profileController.js');
  assert.match(src,/revision:\s*Number\(current\.revision/); assert.match(src,/\$inc:\s*\{ revision: 1 \}/); assert.match(src,/isDeleted:\s*true/);
});

test('only approved reviews may be featured',()=>{
  const src=read('src/controllers/tenant/admin/profileController.js'); assert.match(src,/Only approved reviews can be featured/); assert.match(src,/status: "approved"/);
});

test('profile writes validate external URLs and coordinates',()=>{
  const src=read('src/controllers/tenant/admin/profileController.js'); assert.match(src,/validatePublicProfileInput\(b\)/);
});

test('profile and media writes use revision compare-and-set',()=>{
  const src=read('src/controllers/tenant/admin/profileController.js'); assert.match(src,/saveProfileWithRevision/); assert.match(src,/settings\.profile\.revision/); assert.match(src,/changed in another session/);
});

test('media upload destroys new artifact if persistence loses the race',()=>{
  const src=read('src/controllers/tenant/admin/profileController.js'); assert.match(src,/safeDestroy\(result\.public_id, "image"\)/); assert.match(src,/uploadedPublicIds/);
});

test('old logo/cover assets are destroyed only after new state commits',()=>{
  const src=read('src/controllers/tenant/admin/profileController.js');
  const logo=src.slice(src.indexOf('uploadLogo:'),src.indexOf('uploadFavicon:'));
  assert.ok(logo.indexOf('saveProfileWithRevision') < logo.lastIndexOf('safeDestroy(oldPublicId'));
});

test('admin upload route uses shared restricted image middleware',()=>{
  const src=read('src/routes/tenant/admin/profile.js'); assert.match(src,/schoolProfileMulter/); assert.doesNotMatch(src,/multer\.memoryStorage/);
});

test('public presence migration is wired before index synchronization',()=>{
  const src=read('scripts/create-indexes.js'); assert.match(src,/migratePublicPresence/); assert.ok(src.indexOf('migratePublicPresence') < src.indexOf('createModelIndexes(label, tenantModels)'));
  const pkg=JSON.parse(read('package.json')); assert.equal(pkg.scripts['migrate:public-presence'],'node scripts/migrate-public-presence.js');
});

test('platform profile schema includes revision field',()=>{ assert.match(read('src/models/platform/Tenant.js'),/verified:[\s\S]*revision:/); });

test('review public projection excludes raw email and abuse fingerprint',()=>{
  const src=read('src/services/tenant/publicPresenceService.js'); const block=src.slice(src.indexOf('function sanitizeReview'),src.indexOf('function sanitizeFaq'));
  assert.doesNotMatch(block,/email:/); assert.doesNotMatch(block,/fingerprint:/);
});

test('production public pages cannot be forced into live tenant DB reads by query parameter',()=>{
  for (const f of ['src/controllers/tenant/public/schoolProfilePublicController.js','src/controllers/platform/schoolsPublicController.js']) {
    const src=read(f);
    assert.match(src,/process\.env\.NODE_ENV !== "production"[\s\S]{0,100}req\.query\.live/);
  }
});

test('public pages sanitize profile and branding again at render boundary',()=>{
  for (const f of ['src/controllers/tenant/public/schoolProfilePublicController.js','src/controllers/platform/schoolsPublicController.js']) {
    const src=read(f); assert.match(src,/sanitizePublicProfileForRender/); assert.match(src,/sanitizePublicBranding/); assert.match(src,/Cache-Control/);
  }
});

test('platform projection uses a monotonic public-content claim version',()=>{
  const svcSrc=read('src/services/tenant/publicPresenceService.js');
  assert.match(svcSrc,/publicContentProjectionVersion/);
  assert.match(svcSrc,/findOneAndUpdate/);
  assert.match(svcSrc,/"meta\.publicContentProjectionVersion": version/);
  const tenant=read('src/models/platform/Tenant.js');
  assert.match(tenant,/publicContentProjectionVersion/);
  assert.match(tenant,/lastPublicProjectionAt/);
});

test('review model stores submitter and UA hashes and moderation history',()=>{
  const src=read('src/models/tenant/SchoolReview.js');
  assert.match(src,/submitterHash/); assert.match(src,/userAgentHash/); assert.match(src,/moderationHistory/); assert.match(src,/select:\s*false/);
});

test('review moderation appends lifecycle history',()=>{
  const src=read('src/controllers/tenant/admin/profileController.js');
  for (const action of ['approved','rejected','deleted']) assert.match(src,new RegExp(`action: "${action}"`));
  assert.match(src,/current\.featured \? "unfeatured" : "featured"/);
});

test('profile saves reconcile canonical FAQ/review projection after profile CAS',()=>{
  const src=read('src/controllers/tenant/admin/profileController.js');
  const block=src.slice(src.indexOf('async function saveProfileWithRevision'),src.indexOf('function formatDateTime'));
  assert.match(block,/reconcilePublicPresenceBestEffort\(tenantDoc, models, \{ profileSnapshot: true \}\)/);
});

test('legacy projection fallback cannot leak unpublished FAQs or private review fields',()=>{
  for (const f of ['src/controllers/tenant/public/schoolProfilePublicController.js','src/controllers/platform/schoolsPublicController.js']) {
    const src=read(f);
    const faq=src.slice(src.indexOf('function loadFaqFromProfile'),src.indexOf('function loadNewsFromProfile'));
    const rev=src.slice(src.indexOf('function loadApprovedReviewsFromProfile'),src.indexOf('function normalizeAdmissions'));
    assert.match(faq,/isPublished !== false/); assert.match(faq,/sanitizeFaq/);
    assert.match(rev,/Number\(r\.rating\) >= 1/); assert.match(rev,/sanitizeReview/); assert.match(rev,/!r\.isDeleted/);
  }
});

test('cross-database projection failures are marked pending instead of turning committed profile writes into false failures',()=>{
  const src=read('src/controllers/tenant/admin/profileController.js');
  const helper=src.slice(src.indexOf('async function markPublicPresenceSyncPending'),src.indexOf('async function saveProfileWithRevision'));
  assert.match(helper,/publicPresenceSyncPending/);
  assert.match(helper,/catch \(err\)/);
  assert.match(helper,/return null/);
  const save=src.slice(src.indexOf('async function saveProfileWithRevision'),src.indexOf('function formatDateTime'));
  assert.match(save,/reconcilePublicPresenceBestEffort/);
});

test('successful projection sync clears the pending repair marker',()=>{
  const src=read('src/services/tenant/publicPresenceService.js');
  assert.match(src,/"meta\.publicPresenceSyncPending": false/);
  const tenant=read('src/models/platform/Tenant.js');
  assert.match(tenant,/publicPresenceSyncPending/);
});
