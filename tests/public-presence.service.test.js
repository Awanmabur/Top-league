const test = require('node:test');
const assert = require('node:assert/strict');
const svc = require('../src/services/tenant/publicPresenceService');

test('safe HTTP URLs only', () => {
  assert.equal(svc.isHttpUrl('https://school.test'), true);
  assert.equal(svc.isHttpUrl('http://school.test'), true);
  assert.equal(svc.isHttpUrl('javascript:alert(1)'), false);
  assert.equal(svc.isHttpUrl('data:text/html,x'), false);
});

test('relative apply URL can be allowed explicitly', () => {
  assert.equal(svc.isHttpUrl('/apply', {allowRelative:true}), true);
  assert.equal(svc.isHttpUrl('//evil.test/x', {allowRelative:true}), false);
});

test('profile validation rejects unsafe URLs', () => {
  assert.throws(() => svc.validatePublicProfileInput({website:'javascript:alert(1)'}), /safe HTTP/);
  assert.doesNotThrow(() => svc.validatePublicProfileInput({website:'https://example.test', applyUrl:'/apply'}));
});

test('profile validation constrains coordinates', () => {
  assert.throws(() => svc.validatePublicProfileInput({lat:'91'}), /Latitude/);
  assert.throws(() => svc.validatePublicProfileInput({lng:'181'}), /Longitude/);
});

test('safe colors accept only six-digit hex', () => {
  assert.equal(svc.safeColor('#ABCDEF', '#000000'), '#abcdef');
  assert.equal(svc.safeColor('red; background:url(x)', '#000000'), '#000000');
});

test('review fingerprint is deterministic and input-sensitive', () => {
  const a = svc.reviewFingerprint({ip:'1.2.3.4', emailAddress:'A@B.COM', message:'Good', userAgent:'UA'});
  const b = svc.reviewFingerprint({ip:'1.2.3.4', emailAddress:'a@b.com', message:'Good', userAgent:'UA'});
  const c = svc.reviewFingerprint({ip:'1.2.3.5', emailAddress:'a@b.com', message:'Good', userAgent:'UA'});
  assert.equal(a,b); assert.notEqual(a,c); assert.equal(a.length,64);
});

test('rating summary includes approved non-deleted rows only', () => {
  assert.deepEqual(svc.ratingSummary([
    {status:'approved',rating:5},{status:'approved',rating:3},{status:'pending',rating:1},{status:'approved',rating:1,isDeleted:true}
  ]), {avg:4,count:2});
});

test('review sanitizer removes email and fingerprint', () => {
  const out = svc.sanitizeReview({_id:'1',name:'A',email:'secret@test',fingerprint:'hash',rating:5,status:'approved',message:'ok'});
  assert.equal(out.email, undefined); assert.equal(out.fingerprint, undefined); assert.equal(out.rating,5);
});

test('canonical review submission rejects invalid input', async () => {
  const models={SchoolReview:{findOne(){return {lean:async()=>null}},create:async x=>x}};
  await assert.rejects(() => svc.submitCanonicalReview({models,payload:{name:'',rating:5,message:'x'}}), /Name/);
  await assert.rejects(() => svc.submitCanonicalReview({models,payload:{name:'A',rating:8,message:'x'}}), /Rating/);
  await assert.rejects(() => svc.submitCanonicalReview({models,payload:{name:'A',rating:5,message:''}}), /message/);
});

test('canonical review submission creates pending review without storing raw IP', async () => {
  let created;
  const models={SchoolReview:{findOne(){return {lean:async()=>null}},create:async x=>(created=x,x)}};
  await svc.submitCanonicalReview({models,payload:{name:'A',email:'a@test.com',rating:5,title:'Great',message:'Excellent'},ip:'10.1.2.3',userAgent:'Browser'});
  assert.equal(created.status,'pending'); assert.equal(created.featured,false); assert.equal(created.ip,undefined); assert.equal(created.ipHash.length,64); assert.equal(created.fingerprint.length,64);
});

test('canonical review submission throttles a matching recent fingerprint', async () => {
  const models={SchoolReview:{findOne(){return {lean:async()=>({_id:'dup'})}},create:async()=>{throw new Error('should not create')}}};
  await assert.rejects(() => svc.submitCanonicalReview({models,payload:{name:'A',rating:5,message:'Same'},ip:'1',userAgent:'UA'}), /already submitted/);
});

test('public branding sanitizer blocks CSS and unsafe media URL injection', () => {
  const out = svc.sanitizePublicBranding({
    primaryColor:'red; background:url(https://evil.test/x)',
    accentColor:'#ABCDEF',
    logoUrl:'javascript:alert(1)',
    coverUrl:'/img/school.jpg'
  });
  assert.equal(out.primaryColor, '#0a3d62');
  assert.equal(out.accentColor, '#abcdef');
  assert.equal(out.logoUrl, '');
  assert.equal(out.coverUrl, '/img/school.jpg');
});

test('public profile renderer removes unsafe outbound URLs', () => {
  const out = svc.sanitizePublicProfileForRender({
    contact:{website:'javascript:alert(1)'},
    socials:{facebook:'data:text/html,x',youtube:'https://video.test/a'},
    location:{googleMapUrl:'file:///etc/passwd'},
    admissions:{applyUrl:'/apply'}
  });
  assert.equal(out.contact.website, '');
  assert.equal(out.socials.facebook, '');
  assert.equal(out.socials.youtube, 'https://video.test/a');
  assert.equal(out.location.googleMapUrl, '');
  assert.equal(out.admissions.applyUrl, '/apply');
});

test('review privacy hashes are keyed and raw UA is not persisted', async () => {
  const old = process.env.PUBLIC_REVIEW_FINGERPRINT_SECRET;
  process.env.PUBLIC_REVIEW_FINGERPRINT_SECRET = 'unit-secret';
  let created;
  const models={SchoolReview:{findOne(){return {lean:async()=>null}},countDocuments:async()=>0,create:async x=>(created=x,x)}};
  try {
    await svc.submitCanonicalReview({models,payload:{name:'A',email:'a@test.com',rating:5,message:'Excellent'},ip:'10.1.2.3',userAgent:'Private Browser UA'});
    assert.equal(created.userAgent, '');
    assert.equal(created.ipHash.length,64);
    assert.equal(created.userAgentHash.length,64);
    assert.equal(created.submitterHash.length,64);
    assert.notEqual(created.ipHash, require('node:crypto').createHash('sha256').update('10.1.2.3').digest('hex'));
  } finally {
    if (old === undefined) delete process.env.PUBLIC_REVIEW_FINGERPRINT_SECRET; else process.env.PUBLIC_REVIEW_FINGERPRINT_SECRET=old;
  }
});

test('production review hashing fails closed when no privacy secret exists', () => {
  const keys=['PUBLIC_REVIEW_FINGERPRINT_SECRET','SESSION_SECRET','DATA_ENCRYPTION_KEY','NODE_ENV'];
  const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try {
    delete process.env.PUBLIC_REVIEW_FINGERPRINT_SECRET; delete process.env.SESSION_SECRET; delete process.env.DATA_ENCRYPTION_KEY; process.env.NODE_ENV='production';
    assert.throws(()=>svc.reviewFingerprint({ip:'1.2.3.4',message:'x'}), /required for public reviews/);
  } finally {
    for (const k of keys) { if (old[k] === undefined) delete process.env[k]; else process.env[k]=old[k]; }
  }
});

test('canonical review submission enforces durable per-submitter quota', async () => {
  const models={SchoolReview:{findOne(){return {lean:async()=>null}},countDocuments:async()=>3,create:async()=>{throw new Error('should not create')}}};
  await assert.rejects(()=>svc.submitCanonicalReview({models,payload:{name:'A',email:'a@test.com',rating:5,message:'One'},ip:'1',userAgent:'UA'}), /limit reached/);
});

test('canonical review submission rejects malformed optional email', async () => {
  const models={SchoolReview:{findOne(){return {lean:async()=>null}},countDocuments:async()=>0,create:async x=>x}};
  await assert.rejects(()=>svc.submitCanonicalReview({models,payload:{name:'A',email:'bad-email',rating:5,message:'One'},ip:'1',userAgent:'UA'}), /Email address is invalid/);
});

test('public projection claim prevents an older sync from overwriting a newer claim', async () => {
  let version=0; let writes=[];
  const Model={
    async findOneAndUpdate(){ version+=1; return {meta:{publicContentProjectionVersion:version}}; },
    async updateOne(q,u){
      if (q['meta.publicContentProjectionVersion'] !== version) return {matchedCount:0,modifiedCount:0};
      writes.push(u.$set['settings.profile.ratingSummary']); return {matchedCount:1,modifiedCount:1};
    }
  };
  const tenant={_id:'t1',constructor:Model,settings:{profile:{}},meta:{}};
  let call=0;
  function chain(rows){ return {sort(){return this},limit(){return this},lean:async()=>rows}; }
  const models={
    SchoolFAQ:{find(){return chain([])}},
    SchoolReview:{find(){ call+=1; return chain(call===1 ? [{status:'approved',rating:5}] : [{status:'approved',rating:5},{status:'approved',rating:3}]); }}
  };
  const first=svc.syncPublicProjection(tenant,models);
  const second=svc.syncPublicProjection(tenant,models);
  const [a,b]=await Promise.all([first,second]);
  assert.equal(b.projectionVersion,2);
  assert.equal(a.stale,true);
  assert.deepEqual(writes,[{avg:4,count:2}]);
});
