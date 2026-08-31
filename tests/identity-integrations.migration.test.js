const test = require('node:test');
const assert = require('node:assert/strict');
const { migrateIdentityIntegrations } = require('../scripts/lib/migrateIdentityIntegrations');
const { decryptCredential } = require('../src/services/tenant/integrationService');

function matches(row, q={}) {
  if (q._id !== undefined && String(row._id) !== String(q._id)) return false;
  if (q.usedAt === null && row.usedAt != null) return false;
  if (q.revokedAt === null && row.revokedAt != null) return false;
  if (q.$or) {
    const ok=q.$or.some((c)=>Object.entries(c).every(([k,v])=>{
      if(v && typeof v==='object' && '$exists' in v) return v.$exists ? row[k]!==undefined : row[k]===undefined;
      if(v && typeof v==='object' && '$ne' in v) return row[k]!==v.$ne;
      return row[k]===v;
    }));
    if(!ok)return false;
  }
  return true;
}
function apply(row, update) {
  for (const [k,v] of Object.entries(update.$set||{})) row[k]=v;
  for (const k of Object.keys(update.$unset||{})) delete row[k];
}
function collection(rows) {
  return {
    rows,
    find(q={}) { const arr=rows.filter(r=>matches(r,q)); return { sort(){return this;}, async toArray(){return arr.map(r=>({...r}));} }; },
    async updateOne(q,u){ const r=rows.find(x=>matches(x,q)); if(!r)return{modifiedCount:0}; apply(r,u); return{modifiedCount:1}; },
    async updateMany(q,u){ let n=0; for(const r of rows){if(matches(r,q)){apply(r,u);n++;}} return{modifiedCount:n}; },
  };
}
function model(rows){ return {collection:collection(rows)}; }

function baseModels() {
  return {
    InviteToken:model([]), Notification:model([]), NotificationPreference:model([]), ApiIntegration:model([]),
  };
}

test('migration revokes active legacy invitation hashes instead of pretending they use the new HMAC version', async () => {
  const models=baseModels(); models.InviteToken=model([{_id:'i1',usedAt:null,revokedAt:null,tokenHash:'legacy'}]);
  const out=await migrateIdentityIntegrations(models,{now:new Date('2026-08-30T00:00:00Z')});
  assert.equal(out.inviteTokensRevoked,1); assert.ok(models.InviteToken.collection.rows[0].revokedAt);
});

test('migration infers notification categories and preserves recipient read state separately from admin review', async () => {
  const models=baseModels(); models.Notification=model([
    {_id:'n1',entityType:'Payment',audience:'student',userId:'u1',isRead:true,readAt:new Date('2026-01-01')},
    {_id:'n2',entityType:'SecurityAlert',audience:'admin',userId:null,isRead:true,readAt:new Date('2026-01-02')},
  ]);
  await migrateIdentityIntegrations(models);
  const [n1,n2]=models.Notification.collection.rows;
  assert.equal(n1.category,'finance'); assert.equal(n1.adminReviewedAt,undefined);
  assert.equal(n2.category,'system'); assert.ok(n2.adminReviewedAt);
});

test('migration backfills notification preferences and always keeps system notices enabled', async () => {
  const models=baseModels(); models.NotificationPreference=model([{_id:'p1',inApp:false,system:false,finance:false}]);
  await migrateIdentityIntegrations(models);
  const p=models.NotificationPreference.collection.rows[0]; assert.equal(p.inApp,false); assert.equal(p.finance,false); assert.equal(p.system,true); assert.equal(p.academics,true);
});

test('migration encrypts legacy plaintext API credentials and removes plaintext', async () => {
  process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY='migration-encryption-key-at-least-32-chars'; process.env.ALLOW_INSECURE_INTEGRATION_HTTP='1'; process.env.APP_ENV='test';
  const models=baseModels(); models.ApiIntegration=model([{_id:'a1',name:'Mail',baseUrl:'https://api.example.test',endpoint:'/health',authType:'API Key',apiKey:'plaintext-secret',status:'Disabled',requestLogs:[],metrics:{},isDeleted:false}]);
  const out=await migrateIdentityIntegrations(models);
  const row=models.ApiIntegration.collection.rows[0]; assert.equal(out.plaintextCredentialsEncrypted,1); assert.equal(row.apiKey,undefined); assert.ok(row.credentialCiphertext); assert.equal(decryptCredential(row),'plaintext-secret');
});

test('migration quarantines duplicate active names and invalid integration URLs before unique indexes', async () => {
  process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY='migration-encryption-key-at-least-32-chars'; process.env.ALLOW_INSECURE_INTEGRATION_HTTP='1'; process.env.APP_ENV='test';
  const models=baseModels(); models.ApiIntegration=model([
    {_id:'a1',name:'SMS',baseUrl:'https://one.example.test',endpoint:'/',authType:'None',status:'Disabled',isDeleted:false,createdAt:new Date('2020-01-01')},
    {_id:'a2',name:'SMS',baseUrl:'https://two.example.test',endpoint:'/',authType:'None',status:'Active',isDeleted:false,createdAt:new Date('2021-01-01')},
    {_id:'a3',name:'Bad',baseUrl:'javascript:alert(1)',endpoint:'/',authType:'None',status:'Active',isDeleted:false},
  ]);
  const out=await migrateIdentityIntegrations(models);
  assert.equal(out.duplicateIntegrationsQuarantined,1);
  assert.ok(models.ApiIntegration.collection.rows[1].migrationQuarantinedAt);
  assert.ok(models.ApiIntegration.collection.rows[2].migrationQuarantinedAt);
  assert.equal(models.ApiIntegration.collection.rows[2].status,'Disabled');
});

test('migration normalizes legacy probe logs and limits them to the newest 100 rows', async () => {
  process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY='migration-encryption-key-at-least-32-chars'; process.env.ALLOW_INSECURE_INTEGRATION_HTTP='1'; process.env.APP_ENV='test';
  const logs=Array.from({length:120},(_,i)=>({endpoint:'/x',method:i%2?'GET':'POST',status:i%3?'Success':'Failed',responseTime:`${i}ms`,message:'ok',createdAt:new Date(2026,0,1,0,i)}));
  const models=baseModels(); models.ApiIntegration=model([{_id:'a1',name:'Logs',baseUrl:'https://api.example.test',endpoint:'/',authType:'None',status:'Disabled',isDeleted:false,requestLogs:logs,metrics:{requests:120,avgResponse:'42ms'}}]);
  await migrateIdentityIntegrations(models); const row=models.ApiIntegration.collection.rows[0]; assert.equal(row.requestLogs.length,100); assert.ok(row.requestLogs.every(x=>['HEAD','GET'].includes(x.method))); assert.equal(row.metrics.avgResponseMs,42);
});

test('migration refuses to carry a plaintext secret forward when the encryption key is unavailable', async () => {
  const old=process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY; delete process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY;
  const models=baseModels(); models.ApiIntegration=model([{_id:'a1',name:'Secret',baseUrl:'https://api.example.test',endpoint:'/',authType:'API Key',status:'Disabled',apiKey:'secret',isDeleted:false}]);
  await assert.rejects(()=>migrateIdentityIntegrations(models),/INTEGRATION_CREDENTIAL_ENCRYPTION_KEY/i);
  process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY=old;
});
