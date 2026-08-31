const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'platform-operations-migration-test-secret-123456';

const {
  migratePlatformOperations,
  migratePlatformConfig,
  migratePlatformUsers,
  migrateSupportTickets,
  migrateAuditLogs,
  migrateBookingClaims,
  normalizedFieldwise,
} = require('../scripts/lib/migratePlatformOperations');
const { DEFAULT_CONFIG, normalizeGeneral } = require('../src/services/platformConfigService');

function clone(value) {
  if (value instanceof Date) return new Date(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clone(v)]));
  return value;
}
function comparable(value) {
  if (value instanceof Date) return value.getTime();
  return value;
}
function matches(row, filter = {}) {
  for (const [key, expected] of Object.entries(filter)) {
    if (key === '$or') {
      if (!expected.some((part)=>matches(row, part))) return false;
      continue;
    }
    if (key === '$and') {
      if (!expected.every((part)=>matches(row, part))) return false;
      continue;
    }
    const actual = row[key];
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
      for (const [op, operand] of Object.entries(expected)) {
        if (op === '$lte' && !(comparable(actual) <= comparable(operand))) return false;
        if (op === '$lt' && !(comparable(actual) < comparable(operand))) return false;
        if (op === '$gt' && !(comparable(actual) > comparable(operand))) return false;
        if (op === '$exists' && ((actual !== undefined) !== !!operand)) return false;
        if (op === '$in' && !operand.some((candidate)=>String(candidate) === String(actual))) return false;
      }
      continue;
    }
    if (String(actual) !== String(expected)) return false;
  }
  return true;
}
function applyUpdate(row, update = {}) {
  if (update.$set) for (const [k,v] of Object.entries(update.$set)) row[k] = clone(v);
  if (update.$inc) for (const [k,v] of Object.entries(update.$inc)) row[k] = Number(row[k] || 0) + Number(v || 0);
}
function memoryModel(seed = []) {
  const rows = seed.map(clone);
  let nextId = rows.length + 1;
  return {
    rows,
    find(filter = {}) {
      const selected = rows.filter((row)=>matches(row,filter));
      return { lean: async () => selected.map(clone) };
    },
    async create(doc) {
      const row = clone(doc);
      row._id = row._id || `new-${nextId++}`;
      rows.push(row);
      return clone(row);
    },
    async updateOne(filter, update) {
      const row = rows.find((item)=>matches(item,filter));
      if (!row) return { matchedCount: 0, modifiedCount: 0 };
      applyUpdate(row, update);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(filter) {
      const i = rows.findIndex((item)=>matches(item,filter));
      if (i < 0) return { deletedCount: 0 };
      rows.splice(i,1);
      return { deletedCount: 1 };
    },
    async updateMany(filter, update) {
      let count = 0;
      for (const row of rows) {
        if (!matches(row, filter)) continue;
        applyUpdate(row, update);
        count += 1;
      }
      return { matchedCount: count, modifiedCount: count };
    },
  };
}
function stableRows(model) {
  return JSON.parse(JSON.stringify(model.rows));
}

// Field-wise config normalization
test('config migration field normalizer keeps valid current values ahead of legacy values',()=>{
  const out=normalizedFieldwise({current:{platformName:'Current'},legacy:{platform_name:'Legacy'},defaults:DEFAULT_CONFIG.general,fields:[{key:'platformName',legacyKey:'platform_name'},{key:'baseDomain',legacyKey:'base_domain'},{key:'defaultTimezone',legacyKey:'default_timezone'},{key:'defaultCurrency',legacyKey:'default_currency'}],normalizer:normalizeGeneral});
  assert.equal(out.platformName,'Current');
});
test('config migration field normalizer falls back from invalid current field to valid legacy field',()=>{
  const out=normalizedFieldwise({current:{baseDomain:'https://bad.example'},legacy:{base_domain:'schools.example.com'},defaults:DEFAULT_CONFIG.general,fields:[{key:'platformName',legacyKey:'platform_name'},{key:'baseDomain',legacyKey:'base_domain'},{key:'defaultTimezone',legacyKey:'default_timezone'},{key:'defaultCurrency',legacyKey:'default_currency'}],normalizer:normalizeGeneral});
  assert.equal(out.baseDomain,'schools.example.com');
});
test('config migration field normalizer falls back from invalid current and legacy to safe default',()=>{
  const out=normalizedFieldwise({current:{defaultTimezone:'Mars/Olympus'},legacy:{default_timezone:'Moon/Base'},defaults:DEFAULT_CONFIG.general,fields:[{key:'platformName',legacyKey:'platform_name'},{key:'baseDomain',legacyKey:'base_domain'},{key:'defaultTimezone',legacyKey:'default_timezone'},{key:'defaultCurrency',legacyKey:'default_currency'}],normalizer:normalizeGeneral});
  assert.equal(out.defaultTimezone,DEFAULT_CONFIG.general.defaultTimezone);
});

test('config migration creates canonical singleton from valid legacy settings',async()=>{
  const PlatformConfig=memoryModel([]);const PlatformSetting=memoryModel([{_id:'s1',key:'platform_name',value:'Legacy Academy'},{_id:'s2',key:'default_currency',value:'ugx'}]);
  const result=await migratePlatformConfig({PlatformConfig,PlatformSetting});
  assert.equal(result.created,1);assert.equal(PlatformConfig.rows.length,1);assert.equal(PlatformConfig.rows[0].general.platformName,'Legacy Academy');assert.equal(PlatformConfig.rows[0].general.defaultCurrency,'UGX');
});
test('config migration does not abort on malformed legacy settings',async()=>{
  const PlatformConfig=memoryModel([]);const PlatformSetting=memoryModel([{_id:'s1',key:'default_timezone',value:'Mars/Olympus'},{_id:'s2',key:'brand_primary_color',value:'red;url(x)'},{_id:'s3',key:'session_timeout_minutes',value:'2'}]);
  await migratePlatformConfig({PlatformConfig,PlatformSetting});
  const row=PlatformConfig.rows[0];assert.equal(row.general.defaultTimezone,DEFAULT_CONFIG.general.defaultTimezone);assert.equal(row.branding.primaryColor,DEFAULT_CONFIG.branding.primaryColor);assert.equal(row.security.sessionTimeoutMinutes,DEFAULT_CONFIG.security.sessionTimeoutMinutes);
});
test('config migration keeps newest singleton and removes older duplicates',async()=>{
  const PlatformConfig=memoryModel([{_id:'old',singletonKey:'x',revision:0,general:{platformName:'Old'},updatedAt:new Date('2026-01-01')},{_id:'new',singletonKey:'wrong',revision:4,general:{platformName:'New',defaultTimezone:'Bad/Zone'},updatedAt:new Date('2026-08-30')}]);
  await migratePlatformConfig({PlatformConfig,PlatformSetting:memoryModel([])});
  assert.equal(PlatformConfig.rows.length,1);assert.equal(PlatformConfig.rows[0]._id,'new');assert.equal(PlatformConfig.rows[0].singletonKey,'platform');assert.equal(PlatformConfig.rows[0].revision,4);assert.equal(PlatformConfig.rows[0].general.platformName,'New');assert.equal(PlatformConfig.rows[0].general.defaultTimezone,DEFAULT_CONFIG.general.defaultTimezone);
});

// Platform users
test('platform user migration repairs missing or invalid revision and token version',async()=>{
  const model=memoryModel([{_id:'u1',revision:0,tokenVersion:-2},{_id:'u2',revision:3,tokenVersion:4}]);
  const result=await migratePlatformUsers(model);assert.equal(result.scanned,2);assert.equal(result.normalized,1);assert.equal(model.rows[0].revision,1);assert.equal(model.rows[0].tokenVersion,0);assert.equal(model.rows[1].revision,3);
});
test('platform user migration is content-idempotent',async()=>{
  const model=memoryModel([{_id:'u1',revision:0,tokenVersion:-2}]);await migratePlatformUsers(model);const once=stableRows(model);const again=await migratePlatformUsers(model);assert.deepEqual(stableRows(model),once);assert.equal(again.normalized,0);
});

// Support lifecycle migration
test('support migration normalizes unknown status and positive revision',async()=>{
  const model=memoryModel([{_id:'t1',status:'BROKEN',revision:0,createdAt:new Date('2026-08-01')}]);const result=await migrateSupportTickets(model);assert.equal(result.normalized,1);assert.equal(model.rows[0].status,'open');assert.equal(model.rows[0].revision,1);
});
test('support migration backfills initial status history',async()=>{
  const model=memoryModel([{_id:'t1',status:'pending',revision:2,createdAt:new Date('2026-08-01')}]);const result=await migrateSupportTickets(model);assert.equal(result.historyBackfilled,1);assert.equal(model.rows[0].statusHistory.length,1);assert.equal(model.rows[0].statusHistory[0].toStatus,'pending');assert.equal(model.rows[0].statusHistory[0].revision,2);
});
test('support migration stamps resolved and closed lifecycle dates',async()=>{
  const resolved=memoryModel([{_id:'r',status:'resolved',revision:1,createdAt:new Date('2026-08-01'),updatedAt:new Date('2026-08-02')}]);await migrateSupportTickets(resolved);assert.equal(new Date(resolved.rows[0].resolvedAt).toISOString(),'2026-08-02T00:00:00.000Z');
  const closed=memoryModel([{_id:'c',status:'closed',revision:1,createdAt:new Date('2026-08-01'),updatedAt:new Date('2026-08-03')}]);await migrateSupportTickets(closed);assert.equal(new Date(closed.rows[0].closedAt).toISOString(),'2026-08-03T00:00:00.000Z');
});
test('support migration preserves existing history and timestamps',async()=>{
  const history=[{toStatus:'resolved',revision:1}];const date=new Date('2026-08-04');const model=memoryModel([{_id:'t',status:'resolved',revision:1,statusHistory:history,resolvedAt:date}]);await migrateSupportTickets(model);assert.deepEqual(model.rows[0].statusHistory,history);assert.equal(new Date(model.rows[0].resolvedAt).toISOString(),date.toISOString());
});
test('support migration is content-idempotent after first normalization',async()=>{
  const model=memoryModel([{_id:'t1',status:'bad',revision:0,createdAt:new Date('2026-08-01')}]);await migrateSupportTickets(model);const once=stableRows(model);const again=await migrateSupportTickets(model);assert.deepEqual(stableRows(model),once);assert.equal(again.normalized,0);assert.equal(again.historyBackfilled,0);
});

// Audit privacy migration
test('audit migration masks raw IPv4 and stores HMAC hash',async()=>{
  const model=memoryModel([{_id:'a1',ipAddress:'10.20.30.44',userAgent:'UA',meta:{ok:true}}]);const result=await migrateAuditLogs(model);assert.equal(result.scrubbed,1);assert.equal(model.rows[0].ipAddress,'10.20.30.0');assert.match(model.rows[0].ipHash,/^[a-f0-9]{64}$/);
});
test('audit migration recursively redacts nested secrets',async()=>{
  const model=memoryModel([{_id:'a1',ipAddress:'1.2.3.4',meta:{password:'p',nested:{access_token:'x',safe:'ok'},arr:[{apiKey:'k'}]}}]);await migrateAuditLogs(model);assert.equal(model.rows[0].meta.password,'[REDACTED]');assert.equal(model.rows[0].meta.nested.access_token,'[REDACTED]');assert.equal(model.rows[0].meta.nested.safe,'ok');assert.equal(model.rows[0].meta.arr[0].apiKey,'[REDACTED]');
});
test('audit migration bounds stored user agent',async()=>{
  const model=memoryModel([{_id:'a1',ipAddress:'1.2.3.4',userAgent:'x'.repeat(900),meta:{}}]);await migrateAuditLogs(model);assert.equal(model.rows[0].userAgent.length,400);
});
test('audit migration preserves stable HMAC on already masked rows',async()=>{
  const hash='a'.repeat(64);const model=memoryModel([{_id:'a1',ipAddress:'1.2.3.0',ipHash:hash,userAgent:'UA',meta:{safe:true}}]);const result=await migrateAuditLogs(model);assert.equal(result.scrubbed,0);assert.equal(model.rows[0].ipHash,hash);
});
test('audit migration is content-idempotent after scrubbing raw row',async()=>{
  const model=memoryModel([{_id:'a1',ipAddress:'1.2.3.4',userAgent:'UA',meta:{password:'secret',safe:'yes'}}]);await migrateAuditLogs(model);const once=stableRows(model);const again=await migrateAuditLogs(model);assert.deepEqual(stableRows(model),once);assert.equal(again.scrubbed,0);
});

// Booking claim migration
test('booking migration releases only expired unconfirmed blocking claims',async()=>{
  const now=new Date('2026-08-30T10:00:00Z');const model=memoryModel([
    {_id:'expired',status:'claimed',blocksSlot:true,claimExpiresAt:new Date('2026-08-30T09:00:00Z'),calendarEventId:'',revision:1},
    {_id:'future',status:'claimed',blocksSlot:true,claimExpiresAt:new Date('2026-08-30T11:00:00Z'),calendarEventId:'',revision:1},
    {_id:'calendar',status:'claimed',blocksSlot:true,claimExpiresAt:new Date('2026-08-30T09:00:00Z'),calendarEventId:'evt',revision:1},
  ]);const result=await migrateBookingClaims(model,now);assert.equal(result.expiredClaimsReleased,1);const expired=model.rows.find(x=>x._id==='expired');assert.equal(expired.status,'failed');assert.equal(expired.blocksSlot,false);assert.equal(expired.claimExpiresAt,null);assert.equal(expired.revision,2);assert.equal(model.rows.find(x=>x._id==='future').status,'claimed');assert.equal(model.rows.find(x=>x._id==='calendar').status,'claimed');
});
test('booking migration repairs missing revision',async()=>{const model=memoryModel([{_id:'b',status:'confirmed',blocksSlot:true,claimExpiresAt:null}]);const result=await migrateBookingClaims(model,new Date());assert.equal(result.normalized,1);assert.equal(model.rows[0].revision,1);});
test('booking migration is content-idempotent after release and revision repair',async()=>{const model=memoryModel([{_id:'b',status:'claimed',blocksSlot:true,claimExpiresAt:new Date('2026-01-01'),calendarEventId:'',revision:0}]);await migrateBookingClaims(model,new Date('2026-08-30'));const once=stableRows(model);const again=await migrateBookingClaims(model,new Date('2026-08-30'));assert.deepEqual(stableRows(model),once);assert.equal(again.expiredClaimsReleased,0);assert.equal(again.normalized,0);});

// Whole orchestration
test('platform operations migration executes every authority and returns structured result',async()=>{
  const models={
    PlatformConfig:memoryModel([]),PlatformSetting:memoryModel([{_id:'s',key:'platform_name',value:'Migrated Academy'}]),
    PlatformUser:memoryModel([{_id:'u',revision:0,tokenVersion:-1}]),
    SupportTicket:memoryModel([{_id:'t',status:'bad',revision:0,createdAt:new Date('2026-08-01')}]),
    AuditLog:memoryModel([{_id:'a',ipAddress:'5.6.7.8',meta:{token:'x'}}]),
    PlatformBooking:memoryModel([{_id:'b',status:'claimed',blocksSlot:true,claimExpiresAt:new Date('2026-08-01'),calendarEventId:'',revision:0}]),
  };
  const result=await migratePlatformOperations(models,{now:new Date('2026-08-30')});assert.equal(result.config.created,1);assert.equal(result.users.normalized,1);assert.equal(result.support.historyBackfilled,1);assert.equal(result.audit.scrubbed,1);assert.equal(result.bookings.expiredClaimsReleased,1);
});
test('whole platform operations migration is data-idempotent',async()=>{
  const models={PlatformConfig:memoryModel([]),PlatformSetting:memoryModel([]),PlatformUser:memoryModel([{_id:'u',revision:0,tokenVersion:-1}]),SupportTicket:memoryModel([{_id:'t',status:'bad',revision:0,createdAt:new Date('2026-08-01')}]),AuditLog:memoryModel([{_id:'a',ipAddress:'5.6.7.8',meta:{password:'x'}}]),PlatformBooking:memoryModel([{_id:'b',status:'claimed',blocksSlot:true,claimExpiresAt:new Date('2026-08-01'),calendarEventId:'',revision:0}])};
  await migratePlatformOperations(models,{now:new Date('2026-08-30')});const once=Object.fromEntries(Object.entries(models).map(([k,m])=>[k,stableRows(m)]));await migratePlatformOperations(models,{now:new Date('2026-08-30')});const twice=Object.fromEntries(Object.entries(models).map(([k,m])=>[k,stableRows(m)]));assert.deepEqual(twice,once);
});
