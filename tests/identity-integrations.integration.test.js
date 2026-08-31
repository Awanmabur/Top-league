const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const ejs=require('ejs');
const root=path.join(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');

test('Admin Users links existing canonical profiles instead of creating legacy Program/ClassGroup shadows',()=>{
  const src=read('src/controllers/tenant/admin/usersController.js');
  assert.match(src,/loadProfileForLink/); assert.match(src,/studentProfileId/); assert.match(src,/parentProfileId/); assert.match(src,/staffProfileId/);
  assert.doesNotMatch(src,/models\.Program|models\.ClassGroup|Program\.create|ClassGroup\.create/);
  assert.match(src,/createAccountWithCompensation/); assert.match(src,/tryTransaction/);
});

test('User fallback creation and deletion compensate partial profile/invite state',()=>{
  const src=read('src/controllers/tenant/admin/usersController.js');
  assert.match(src,/InviteToken\?\.deleteMany\(\{ userId: uid \}\)/);
  assert.match(src,/Student\?\.updateMany\(\{ userId: uid \}/);
  assert.match(src,/restoreProfileLinks/); assert.match(src,/rollbackDeletedUser/);
  assert.match(src,/Bulk action would remove the only remaining active admin/);
});

test('resend invite cannot be used as a password-reset bypass for active accounts',()=>{
  const src=read('src/controllers/tenant/admin/usersController.js');
  assert.match(src,/Password is already set\. Use the password-reset workflow/);
  assert.match(src,/select\("\+passwordHash"\)/);
});

test('staff and lecturer portal auth now requires reciprocal active Staff identity',()=>{
  const src=read('src/middleware/tenant/requireTenantAuth.js');
  assert.match(src,/STAFF_PORTAL_ROLES\.includes\(primaryRole\)/);
  assert.match(src,/if \(!user\.staffId \|\| !req\.models\?\.Staff\)/);
  assert.match(src,/userId: user\._id/); assert.match(src,/\["Suspended", "Exited"\]/);
});

test('all tenant invitation consumers share HMAC hashRawToken contract and atomic claim compensation',()=>{
  const util=read('src/utils/inviteToken.js'), active=read('src/controllers/tenant/tenant/inviteAuthController.js'), alias=read('src/controllers/tenant/admin/inviteAuthController.js');
  assert.match(util,/createHmac\("sha256"/); assert.match(util,/INVITE_TOKEN_SECRET/);
  assert.match(active,/hashRawToken\(rawToken\)/); assert.match(active,/findOneAndUpdate/); assert.match(active,/releaseClaim/); assert.match(active,/Hash before claiming/);
  assert.match(alias,/require\("\.\.\/tenant\/inviteAuthController"\)/);
  assert.doesNotMatch(alias,/createHash\("sha256"/);
});

test('Notification broadcast state is per-user through NotificationReceipt and admin review is separate',()=>{
  const model=read('src/models/tenant/Notification.js'), receipt=read('src/models/tenant/NotificationReceipt.js'), admin=read('src/controllers/tenant/admin/notificationsController.js');
  assert.match(model,/adminReviewedAt/); assert.match(receipt,/notificationId/); assert.match(receipt,/userId/); assert.match(receipt,/unique:\s*true/);
  assert.match(admin,/adminReviewedAt/); assert.doesNotMatch(admin,/\$set:\{isRead:true,readAt/);
});

test('Notification preferences cover all operational categories and system remains mandatory',()=>{
  const pref=read('src/models/tenant/NotificationPreference.js'), service=read('src/services/tenant/notificationService.js');
  for(const k of ['academics','finance','admissions','events','library','hostel','transport','discipline','messages','system']) assert.match(pref,new RegExp(`${k}:`));
  assert.match(service,/category === "system"/); assert.match(service,/key === "system" \? true/);
});

test('Student Parent and Staff notification writes include CSRF plus read-all and preferences',()=>{
  for(const p of ['views/students/notifications.ejs','views/parents/notifications.ejs','views/staff/notifications.ejs']){
    const s=read(p); assert.match(s,/notifications\/preferences/); assert.match(s,/notifications\/read-all/); assert.match(s,/name="_csrf"/); assert.match(s,/System \(required\)/);
  }
});

test('API Integration credentials are encrypted/select:false and plaintext legacy field is migration-only',()=>{
  const model=read('src/models/tenant/ApiIntegration.js'), ctrl=read('src/controllers/tenant/admin/api-integrationsController.js');
  assert.match(model,/credentialCiphertext:.*select: false/s); assert.match(model,/apiKey:.*select: false/s);
  assert.match(ctrl,/encryptCredential/); assert.match(ctrl,/\$unset:\s*\{ apiKey:/); assert.match(ctrl,/credentialConfigured/);
  assert.doesNotMatch(ctrl,/responseTime:\s*ok \? "220ms"/);
});

test('API Integration probes enforce SSRF checks and pin validated DNS address',()=>{
  const service=read('src/services/tenant/integrationService.js');
  assert.match(service,/Private or reserved integration targets are not allowed/);
  assert.match(service,/callback\(null, chosen\.address, chosen\.family\)/);
  assert.match(service,/prevents DNS rebinding/); assert.match(service,/redirect: "manual"/);
  assert.match(service,/statusCode >= 200 && statusCode < 300/);
});

test('API Integration admin routes use the real mounted /admin/integrations path and export logs',()=>{
  const idx=read('src/routes/tenant/admin/index.js'), routes=read('src/routes/tenant/admin/api-integrations.js'), view=read('views/tenant/api-integrations/index.ejs'), js=read('public/js/api-integrations.js');
  assert.match(idx,/"\/integrations"/); assert.match(routes,/"\/logs\/export"/);
  assert.doesNotMatch(view,/\/admin\/api-integrations/); assert.doesNotMatch(js,/\/admin\/api-integrations/);
  assert.match(view,/\/admin\/integrations\/logs\/export/);
});

test('API Integration UI uses revision CAS, selectable probe method and no database-backed innerHTML',()=>{
  const view=read('views/tenant/api-integrations/index.ejs'), js=read('public/js/api-integrations.js');
  assert.match(view,/name="integrationRevision"/); assert.match(view,/name="testMethod"/); assert.match(js,/integrationRevision/);
  assert.doesNotMatch(js,/\.innerHTML\s*=/); assert.match(js,/replaceChildren/);
});

test('API Integration JSON bootstraps are RCDATA-safe',()=>{
  const view=read('views/tenant/api-integrations/index.ejs');
  assert.ok(view.includes('.replace(/&/g,"\\\\u0026")')); assert.ok(view.includes('.replace(/</g,"\\\\u003c")')); assert.ok(view.includes('.replace(/>/g,"\\\\u003e")'));
});

test('production runtime requires an integration credential encryption key',()=>{
  const runtime=read('src/config/runtime.js');
  const readiness=read('src/config/productionReadiness.js');
  assert.match(runtime,/assertProductionReadiness\(process\.env\)/);
  assert.match(readiness,/INTEGRATION_CREDENTIAL_ENCRYPTION_KEY/);
  assert.match(readiness,/secret\('INTEGRATION_CREDENTIAL_ENCRYPTION_KEY'\)/);
});

test('identity/integration migration is wired before index synchronization',()=>{
  const pkg=require('../package.json'), indexes=read('scripts/create-indexes.js');
  assert.equal(pkg.scripts['migrate:identity-integrations'],'node scripts/migrate-identity-integrations.js');
  assert.match(indexes,/migrateIdentityIntegrations/); assert.ok(indexes.indexOf('migrateIdentityIntegrations(tenantModels)') < indexes.indexOf('createModelIndexes(label, tenantModels)'));
});

test('API Integration unique active-name index excludes migration quarantine',()=>{
  const src=read('src/models/tenant/ApiIntegration.js');
  assert.match(src,/partialFilterExpression:\s*\{ isDeleted: false, migrationQuarantinedAt: null \}/);
  assert.match(src,/requestLogs/); assert.match(src,/revision/); assert.match(src,/migrationQuarantineReason/);
});

test('Admin integration controller bounds list/log history and bulk probes',()=>{
  const src=read('src/controllers/tenant/admin/api-integrationsController.js');
  assert.match(src,/\.limit\(250\)/); assert.match(src,/\$slice: -100/); assert.match(src,/ids\.length > 50/); assert.match(src,/slice\(0, cap\)/);
});

test('API Integration log CSV is formula-safe and contains HTTP status instead of response bodies',()=>{
  const src=read('src/controllers/tenant/admin/api-integrationsController.js');
  assert.match(src,/\^\[=\+\\-@\]/); assert.match(src,/HTTP Status/); assert.doesNotMatch(src,/response\.text\(/);
});

test('active Identity & Integrations EJS templates compile',()=>{
  for(const rel of ['views/tenant/users/index.ejs','views/tenant/notifications/index.ejs','views/tenant/api-integrations/index.ejs','views/students/notifications.ejs','views/parents/notifications.ejs','views/staff/notifications.ejs']){
    assert.doesNotThrow(()=>ejs.compile(read(rel),{filename:path.join(root,rel)}),rel);
  }
});
