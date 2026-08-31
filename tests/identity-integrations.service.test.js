const test = require('node:test');
const assert = require('node:assert/strict');
const {
  encryptCredential, decryptCredential, maskCredential, isPrivateIp, buildProbeUrl,
  assertSafeHost, probeIntegration, nextAverage,
} = require('../src/services/tenant/integrationService');
const {
  inferCategory, preferenceAllows, savePreference, isDirectForUser,
  markPortalNotificationRead, countUnreadPortalNotifications,
} = require('../src/services/tenant/notificationService');
const { requireRole, loadProfileForLink, linkProfile } = require('../src/services/tenant/userAccessService');

process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY = 'identity-integrations-test-key-32-characters-minimum';
process.env.ALLOW_INSECURE_INTEGRATION_HTTP = '1';
process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'test';

function chain(value) {
  return { session(){return this;}, select(){return this;}, lean(){return Promise.resolve(value);}, then(ok,bad){return Promise.resolve(value).then(ok,bad);} };
}

test('integration credentials encrypt with AES-GCM and round-trip without plaintext fields', () => {
  const enc = encryptCredential('super-secret-token');
  assert.ok(enc.credentialCiphertext && enc.credentialIv && enc.credentialTag);
  assert.notEqual(enc.credentialCiphertext, 'super-secret-token');
  assert.equal(decryptCredential(enc), 'super-secret-token');
  assert.equal(maskCredential(enc), '••••••••••••');
});

test('integration private/reserved IP detector blocks common SSRF ranges', () => {
  for (const ip of ['127.0.0.1','10.0.0.1','172.16.1.1','192.168.1.2','169.254.1.1','::1','fd00::1']) assert.equal(isPrivateIp(ip), true, ip);
  assert.equal(isPrivateIp('8.8.8.8'), false);
  assert.equal(isPrivateIp('2606:4700:4700::1111'), false);
});

test('integration endpoint cannot escape its configured origin', () => {
  assert.equal(buildProbeUrl('https://api.example.test/v1', '/health').origin, 'https://api.example.test');
  assert.throws(() => buildProbeUrl('https://api.example.test', 'https://evil.example.test/steal'), /same|origin|configured/i);
});

test('integration DNS safety rejects private resolution and accepts public resolution', async () => {
  const u = new URL('https://api.example.test/health');
  await assert.rejects(() => assertSafeHost(u, async () => [{address:'127.0.0.1',family:4}]), /private|reserved/i);
  const rows = await assertSafeHost(u, async () => [{address:'8.8.8.8',family:4}]);
  assert.equal(rows[0].address, '8.8.8.8');
});

test('real integration probe sends configured auth but does not return response body', async () => {
  const row = { baseUrl:'https://api.example.test', endpoint:'/health?x=1', testMethod:'GET', authType:'API Key', ...encryptCredential('token-123') };
  let seen;
  const result = await probeIntegration(row, {
    lookup: async () => [{address:'8.8.8.8',family:4}],
    fetchImpl: async (url, options) => { seen={url:String(url),options}; return {status:204,text:async()=> 'SECRET BODY'}; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 204);
  assert.equal(seen.options.headers['X-API-Key'], 'token-123');
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'body'), false);
  assert.match(result.endpoint, /^https:\/\/api\.example\.test\/health$/);
});

test('integration probe blocks credential-bearing redirect logic by using manual redirects', async () => {
  const row = { baseUrl:'https://api.example.test', endpoint:'/health', testMethod:'HEAD', authType:'None', ...encryptCredential('') };
  let redirect;
  await probeIntegration(row, { lookup: async()=>[{address:'8.8.8.8',family:4}], fetchImpl: async (_u,o)=>{redirect=o.redirect;return{status:302};} });
  assert.equal(redirect, 'manual');
});

test('incremental response average uses prior request count', () => {
  assert.equal(nextAverage(200, 4, 300), 220);
  assert.equal(nextAverage(0, 0, 155), 155);
});

test('notification category inference maps canonical entity types', () => {
  assert.equal(inferCategory({entityType:'Payment'}), 'finance');
  assert.equal(inferCategory({entityType:'Exam'}), 'academics');
  assert.equal(inferCategory({entityType:'TransportAssignment'}), 'transport');
  assert.equal(inferCategory({entityType:'SecurityAlert'}), 'system');
  assert.equal(inferCategory({category:'events', entityType:'Payment'}), 'events');
});

test('system notifications bypass optional in-app/category opt-outs', () => {
  assert.equal(preferenceAllows({inApp:false,system:false},{category:'system'}), true);
  assert.equal(preferenceAllows({inApp:false,general:true},{category:'general'}), false);
  assert.equal(preferenceAllows({inApp:true,finance:false},{category:'finance'}), false);
});

test('saving notification preferences always forces system notices on', async () => {
  let update;
  const model={findOneAndUpdate(_q,u){update=u;return Promise.resolve(u.$set);}};
  const out=await savePreference({NotificationPreference:model},{_id:'u1'},{inApp:false,system:false,finance:false});
  assert.equal(update.$set.system,true);
  assert.equal(update.$set.inApp,false);
  assert.equal(update.$set.finance,false);
  assert.equal(out.system,true);
});

test('direct notification matching does not confuse broadcast audience with ownership', () => {
  const user={_id:'u1',email:'a@example.test'};
  assert.equal(isDirectForUser({userId:'u1'},user),true);
  assert.equal(isDirectForUser({audience:'all'},user),false);
});

test('broadcast read state writes a per-user receipt, not shared notification read state', async () => {
  let receiptUpdate=0, notificationUpdate=0;
  const Notification={findOne(){return chain({_id:'n1',audience:'all',userId:null,user:null,email:null});},updateOne(){notificationUpdate++;return Promise.resolve();}};
  const NotificationReceipt={updateOne(q,u,o){receiptUpdate++;assert.equal(q.userId,'u1');assert.equal(o.upsert,true);return Promise.resolve();}};
  await markPortalNotificationRead({Notification,NotificationReceipt},{_id:'u1',email:'u@example.test'},'n1',['student']);
  assert.equal(receiptUpdate,1); assert.equal(notificationUpdate,0);
});

test('unread portal count uses effective receipt state', async () => {
  const rows=[{_id:'n1',audience:'all',isDeleted:false},{_id:'n2',audience:'all',isDeleted:false}];
  const Notification={find(){return{sort(){return this;},limit(){return this;},lean(){return Promise.resolve(rows);}}}};
  const NotificationReceipt={find(){return chain([{notificationId:'n1',userId:'u1',readAt:new Date()}]);}};
  const NotificationPreference={findOne(){return chain(null);}};
  const count=await countUnreadPortalNotifications({Notification,NotificationReceipt,NotificationPreference},{_id:'u1',email:'x@example.test'},['student']);
  assert.equal(count,1);
});

test('user access accepts only known roles', () => {
  assert.equal(requireRole('parent'),'parent');
  assert.throws(()=>requireRole('superadmin'),/Invalid role/i);
});

test('student account linking requires an existing unlinked canonical Student profile with matching email', async () => {
  const Student={findOne(){return chain({_id:'s1',email:'student@example.test',status:'active',userId:null});}};
  const linked=await loadProfileForLink({Student},'student','507f1f77bcf86cd799439011','student@example.test');
  assert.equal(linked.kind,'Student');
  await assert.rejects(()=>loadProfileForLink({Student},'student','507f1f77bcf86cd799439011','other@example.test'),/email must match/i);
});

test('profile linking writes reciprocal identity with compare-and-set semantics', async () => {
  let profileFilter,userUpdate;
  const Student={updateOne(f){profileFilter=f;return Promise.resolve({modifiedCount:1});}};
  const User={updateOne(_f,u){userUpdate=u;return Promise.resolve({modifiedCount:1});}};
  const user={_id:'u1',email:'student@example.test'};
  await linkProfile({Student,User},user,{kind:'Student',doc:{_id:'s1',email:'student@example.test'}},null,'admin1');
  assert.ok(profileFilter.$or);
  assert.equal(userUpdate.$set.studentId,'s1');
  assert.equal(user.studentId,'s1');
});
