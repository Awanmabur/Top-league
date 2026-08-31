const test = require('node:test');
const assert = require('node:assert/strict');
const { migratePublicPresence } = require('../scripts/lib/migratePublicPresence');
function fakeModel(seed=[]) {
  const rows=[...seed];
  return {
    rows,
    findOne(q){ return { lean: async()=> rows.find(r=>Object.entries(q).every(([k,v])=>k==='isDeleted'?r.isDeleted!==true:r[k]===v)) || null }; },
    async create(doc){ const row={_id:String(rows.length+1),...doc}; rows.push(row); return row; }
  };
}

test('migration imports embedded FAQ and review once', async () => {
  const SchoolFAQ=fakeModel(), SchoolReview=fakeModel(), TenantProfile=fakeModel();
  const tenant={name:'School',code:'sch',settings:{profile:{faqs:[{q:'Q?',a:'A'}],reviews:[{name:'N',rating:5,message:'M',status:'approved'}]},branding:{},preferences:{}}};
  const a=await migratePublicPresence({SchoolFAQ,SchoolReview,TenantProfile},{tenant});
  const b=await migratePublicPresence({SchoolFAQ,SchoolReview,TenantProfile},{tenant});
  assert.equal(a.faqsImported,1); assert.equal(a.reviewsImported,1); assert.equal(a.profileUpserted,1);
  assert.equal(b.faqsImported,0); assert.equal(b.reviewsImported,0); assert.equal(b.profileUpserted,0);
});

test('migration does not publish invalid review ratings', async () => {
  const SchoolFAQ=fakeModel(), SchoolReview=fakeModel(), TenantProfile=fakeModel([{singletonKey:'school',isDeleted:false}]);
  const tenant={name:'School',settings:{profile:{reviews:[{name:'N',rating:9,status:'approved'}]},branding:{},preferences:{}}};
  await migratePublicPresence({SchoolFAQ,SchoolReview,TenantProfile},{tenant});
  assert.equal(SchoolReview.rows.length,0);
});

test('legacy rejected review cannot remain featured', async () => {
  const SchoolFAQ=fakeModel(), SchoolReview=fakeModel(), TenantProfile=fakeModel([{singletonKey:'school',isDeleted:false}]);
  const tenant={name:'School',settings:{profile:{reviews:[{name:'N',rating:2,message:'M',status:'rejected',featured:true}]},branding:{},preferences:{}}};
  await migratePublicPresence({SchoolFAQ,SchoolReview,TenantProfile},{tenant});
  assert.equal(SchoolReview.rows[0].featured,false);
});

test('tenant profile migration creates a singleton snapshot', async () => {
  const SchoolFAQ=fakeModel(), SchoolReview=fakeModel(), TenantProfile=fakeModel();
  const tenant={name:'School',code:'sch',settings:{profile:{enabled:true,shortName:'SC'},branding:{primaryColor:'#123456'},preferences:{allowPublicProfile:true}}};
  await migratePublicPresence({SchoolFAQ,SchoolReview,TenantProfile},{tenant});
  assert.equal(TenantProfile.rows[0].singletonKey,'school');
  assert.equal(TenantProfile.rows[0].publicProfile.shortName,'SC');
});

test('migration does not preserve raw legacy user-agent or weak IP hash in canonical review', async () => {
  let created;
  const models={
    SchoolFAQ:null,
    SchoolReview:{findOne(){return {lean:async()=>null}},create:async x=>(created=x,x)},
    TenantProfile:null,
  };
  await migratePublicPresence(models,{tenant:{settings:{profile:{reviews:[{name:'A',rating:5,message:'x',status:'approved',ipHash:'weak',userAgent:'Legacy UA'}]}}}});
  assert.equal(created.ipHash,''); assert.equal(created.userAgent,''); assert.equal(created.userAgentHash.length,64);
  assert.equal(created.moderationHistory[0].action,'approved');
});

test('migration sanitizes unsafe legacy branding and website before canonical snapshot', async () => {
  let created;
  const models={SchoolFAQ:null,SchoolReview:null,TenantProfile:{findOne(){return {lean:async()=>null}},create:async x=>(created=x,x)}};
  await migratePublicPresence(models,{tenant:{name:'School',code:'s',settings:{profile:{contact:{website:'javascript:alert(1)'}},branding:{primaryColor:'red; background:url(x)',logoUrl:'javascript:alert(1)'},preferences:{}}}});
  assert.equal(created.website,''); assert.equal(created.logoUrl,''); assert.equal(created.primaryColor,'#0a3d62');
});
