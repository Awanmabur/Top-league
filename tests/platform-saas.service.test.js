const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const svc = require('../src/services/platformSubscriptionService');
const checkTenantLimit = require('../src/utils/checkTenantLimit');
const { assertTenantLimitAvailable, compensateIfTenantLimitExceeded } = checkTenantLimit;

const oid = () => new mongoose.Types.ObjectId();
const plan = (overrides = {}) => ({
  _id: oid(), revision: 3, name: 'Growth', code: 'growth', billingModel: 'school_only',
  pricePerSchool: 100, pricePerStudent: 0, platformSharePercent: 0, currency: 'USD',
  billingInterval: 'monthly', trialDays: 14, maxStudents: 500, maxStaff: 50, maxCampuses: 3,
  enabledModules: ['finance'], featureFlags: { customDomain: false, advancedReports: true },
  ...overrides,
});
const subscription = (overrides = {}) => ({
  _id: oid(), tenantId: oid(), planId: oid(), revision: 4, status: 'active',
  startsAt: new Date('2026-08-01T00:00:00Z'), currentPeriodStart: new Date('2026-08-01T00:00:00Z'),
  currentPeriodEnd: new Date('2026-09-01T00:00:00Z'), trialEndsAt: null,
  planSnapshot: svc.snapshotPlan(plan()), ...overrides,
});

test('feature flags fail closed for premium capabilities while baseline safety features default on', () => {
  const f = svc.normalizeFeatureFlags({});
  assert.equal(f.customDomain, false); assert.equal(f.apiAccess, false); assert.equal(f.advancedReports, false);
  assert.equal(f.backups, true); assert.equal(f.systemHealth, true);
});
test('plan validation accepts bounded canonical values', () => { const x=svc.validatePlanInput(plan()); assert.equal(x.billingModel,'school_only'); assert.equal(x.maxStudents,500); assert.equal(x.maxCampuses,3); });
test('plan validation rejects unknown billing model', () => assert.throws(()=>svc.validatePlanInput(plan({billingModel:'magic'})),/billing model/i));
test('plan validation rejects zero campus capacity', () => assert.throws(()=>svc.validatePlanInput(plan({maxCampuses:0})),/at least 1/i));
test('plan validation rejects invalid currency', () => assert.throws(()=>svc.validatePlanInput(plan({currency:'$'})),/currency/i));
test('plan validation rejects negative prices and percentages over 100', () => { assert.throws(()=>svc.validatePlanInput(plan({pricePerSchool:-1})),/price/i); assert.throws(()=>svc.validatePlanInput(plan({platformSharePercent:101})),/share/i); });
test('plan snapshots freeze plan revision and limits', () => { const p=plan(); const snap=svc.snapshotPlan(p); p.maxStudents=999; assert.equal(snap.planRevision,3); assert.equal(snap.maxStudents,500); });
test('initial trial subscription receives future trial window and history', () => { const now=new Date('2026-08-30T00:00:00Z'); const x=svc.buildInitialSubscription({tenantId:oid(),plan:plan(),now}); assert.equal(x.status,'trial'); assert.equal(x.trialEndsAt.toISOString(),'2026-09-13T00:00:00.000Z'); assert.equal(x.history[0].action,'created'); });
test('initial active fixed subscription derives paid window from frozen interval', () => { const now=new Date('2026-08-30T00:00:00Z'); const x=svc.buildInitialSubscription({tenantId:oid(),plan:plan(),requestedStatus:'active',statusReason:'approved override',now}); assert.equal(x.currentPeriodEnd.toISOString(),'2026-09-30T00:00:00.000Z'); assert.equal(x.history[0].action,'created_active_override'); assert.equal(x.statusReason,'approved override'); });
test('initial active custom subscription is forbidden without a completed payment', () => assert.throws(()=>svc.buildInitialSubscription({tenantId:oid(),plan:plan({billingInterval:'custom'}),requestedStatus:'active'}),/completed payment|custom-billing/i));
test('effective trial status expires exactly at trial end', () => { const s=subscription({status:'trial',trialEndsAt:new Date('2026-08-30T10:00:00Z'),currentPeriodEnd:null}); assert.equal(svc.subscriptionEffectiveStatus(s,new Date('2026-08-30T10:00:00Z')),'expired'); });
test('effective active status becomes past due at paid-period end', () => { const s=subscription({currentPeriodEnd:new Date('2026-08-30T10:00:00Z')}); assert.equal(svc.subscriptionEffectiveStatus(s,new Date('2026-08-30T10:00:00Z')),'past_due'); });
test('only trial and active effective statuses are operational', () => { assert.equal(svc.isSubscriptionOperational(subscription(),new Date('2026-08-15')),true); assert.equal(svc.isSubscriptionOperational(subscription({status:'suspended'})),false); });
test('tenant projection suspends expired/past-due access', () => { const s=subscription({status:'active',currentPeriodEnd:new Date('2020-01-01')}); const p=svc.tenantProjectionFromSubscription(s); assert.equal(p.status,'suspended'); assert.equal(String(p.subscriptionId),String(s._id)); });
test('subscription transition map rejects cancelled reactivation', () => assert.throws(()=>svc.assertSubscriptionTransition('cancelled','active'),/cannot move/i));
test('subscription transition map permits past-due renewal', () => assert.equal(svc.assertSubscriptionTransition('past_due','active'),true));
test('tenant status mapping rejects deleted as a subscription mutation', () => assert.throws(()=>svc.mapTenantStatusToSubscription('deleted'),/invalid tenant/i));
test('campus limit enforces frozen plan capacity', () => { assert.doesNotThrow(()=>svc.assertCampusLimit({maxCampuses:2},2)); assert.throws(()=>svc.assertCampusLimit({maxCampuses:2},3),/at most 2/i); });
test('plan downgrade usage preflight rejects existing student or staff overage', () => { assert.throws(()=>svc.assertTenantUsageLimits({maxStudents:10,maxStaff:5,maxCampuses:2},{students:11,staff:2,campuses:1}),/at most 10 students/i); assert.throws(()=>svc.assertTenantUsageLimits({maxStudents:10,maxStaff:5,maxCampuses:2},{students:10,staff:6,campuses:1}),/at most 5 staff/i); });
test('plan downgrade usage preflight accepts exact licensed capacity', () => assert.doesNotThrow(()=>svc.assertTenantUsageLimits({maxStudents:10,maxStaff:5,maxCampuses:2},{students:10,staff:5,campuses:2})));
test('custom domain requires explicit frozen feature', () => { assert.throws(()=>svc.assertCustomDomainAllowed({featureFlags:{customDomain:false}},'school.example.com'),/not enabled/i); assert.doesNotThrow(()=>svc.assertCustomDomainAllowed({featureFlags:{customDomain:true}},'school.example.com')); });
test('payment reference keys are tenant scoped and case-normalized', () => { const a=oid(),b=oid(); const k1=svc.paymentReferenceKey('BANK',' Ref-1 ',a),k2=svc.paymentReferenceKey('bank','ref-1',a),k3=svc.paymentReferenceKey('bank','ref-1',b); assert.equal(k1,k2); assert.notEqual(k1,k3); });
test('payment reference key fails closed without tenant or reference', () => { assert.equal(svc.paymentReferenceKey('bank','',oid()),null); assert.equal(svc.paymentReferenceKey('bank','x',null),null); });
test('completed subscription payment requires reference', () => assert.throws(()=>svc.validatePaymentInput({type:'school_subscription',amount:100,currency:'USD',reference:''},{tenant:{_id:oid(),currency:'USD'},subscription:subscription()}),/reference/i));
test('subscription payment currency must match frozen plan', () => assert.throws(()=>svc.validatePaymentInput({type:'school_subscription',amount:100,currency:'UGX',reference:'x'},{tenant:{_id:oid()},subscription:subscription()}),/currency/i));
test('school-only plan rejects student subscription payment', () => assert.throws(()=>svc.validatePaymentInput({type:'student_subscription',amount:100,currency:'USD',reference:'x'},{tenant:{_id:oid()},subscription:subscription()}),/school-level/i));
test('student-only plan rejects school subscription payment', () => { const s=subscription(); s.planSnapshot.billingModel='student_only'; s.planSnapshot.pricePerStudent=5; assert.throws(()=>svc.validatePaymentInput({type:'school_subscription',amount:100,currency:'USD',reference:'x'},{tenant:{_id:oid()},subscription:s}),/student-level/i); });
test('subscription payment enforces frozen minimum amount', () => assert.throws(()=>svc.validatePaymentInput({type:'school_subscription',amount:99,currency:'USD',reference:'x'},{tenant:{_id:oid()},subscription:subscription()}),/at least 100/i));
test('fixed billing ignores browser dates and derives monthly window from now when expired', () => { const tenant={_id:oid()}; const s=subscription({currentPeriodEnd:new Date('2026-08-01')}); const x=svc.validatePaymentInput({type:'school_subscription',amount:100,currency:'USD',reference:'x',periodStart:'2030-01-01',periodEnd:'2040-01-01'},{tenant,subscription:s,now:new Date('2026-08-30T00:00:00Z')}); assert.equal(x.periodStart.toISOString(),'2026-08-30T00:00:00.000Z'); assert.equal(x.periodEnd.toISOString(),'2026-09-30T00:00:00.000Z'); });
test('fixed renewal chains from current paid-through date', () => { const tenant={_id:oid()}; const s=subscription({currentPeriodEnd:new Date('2026-09-20T00:00:00Z')}); const x=svc.validatePaymentInput({type:'school_subscription',amount:100,currency:'USD',reference:'x'},{tenant,subscription:s,now:new Date('2026-08-30T00:00:00Z')}); assert.equal(x.periodStart.toISOString(),'2026-09-20T00:00:00.000Z'); assert.equal(x.periodEnd.toISOString(),'2026-10-20T00:00:00.000Z'); });
test('custom billing requires explicit period end', () => { const tenant={_id:oid()}; const s=subscription(); s.planSnapshot.billingInterval='custom'; assert.throws(()=>svc.validatePaymentInput({type:'school_subscription',amount:100,currency:'USD',reference:'x'},{tenant,subscription:s,now:new Date('2026-09-02')}),/explicit period end/i); });
test('custom renewal cannot overlap existing paid period', () => { const tenant={_id:oid()}; const s=subscription(); s.planSnapshot.billingInterval='custom'; assert.throws(()=>svc.validatePaymentInput({type:'school_subscription',amount:100,currency:'USD',reference:'x',periodStart:'2026-08-20',periodEnd:'2026-10-01'},{tenant,subscription:s,now:new Date('2026-08-30')}),/cannot begin before/i); });
test('inactive custom subscription cannot activate far before paid period starts', () => { const tenant={_id:oid()}; const s=subscription({status:'suspended',currentPeriodEnd:null}); s.planSnapshot.billingInterval='custom'; assert.throws(()=>svc.validatePaymentInput({type:'school_subscription',amount:100,currency:'USD',reference:'x',periodStart:'2026-09-15',periodEnd:'2026-10-15'},{tenant,subscription:s,now:new Date('2026-08-30')}),/cannot be activated before/i); });
test('paid-at timestamp cannot be materially in the future', () => assert.throws(()=>svc.validatePaymentInput({type:'manual_adjust',amount:1,currency:'USD',reference:'x',paidAt:'2026-08-31T00:00:00Z'},{tenant:{_id:oid()},subscription:subscription(),now:new Date('2026-08-30T00:00:00Z')}),/future/i));
test('non-subscription adjustments never require subscription activation semantics', () => { const x=svc.validatePaymentInput({type:'manual_adjust',amount:1,currency:'USD',reference:'x'},{tenant:{_id:oid(),currency:'USD'},subscription:subscription(),now:new Date('2026-08-30')}); assert.equal(x.type,'manual_adjust'); });
test('subscription projection refuses non-subscription payment', () => assert.throws(()=>svc.subscriptionPaymentProjection(subscription(),{type:'credit',status:'completed'}),/only subscription/i));
test('subscription projection refuses pending payment', () => assert.throws(()=>svc.subscriptionPaymentProjection(subscription(),{type:'school_subscription',status:'pending'}),/only completed/i));
test('completed subscription payment activates and clears suspension markers', () => { const p={_id:oid(),type:'school_subscription',status:'completed',periodStart:new Date('2026-08-30'),periodEnd:new Date('2026-09-30'),paidAt:new Date('2026-08-30')}; const x=svc.subscriptionPaymentProjection(subscription({status:'past_due'}),p,oid()); assert.equal(x.status,'active'); assert.equal(x.suspendedAt,null); assert.equal(String(x.lastPaymentId),String(p._id)); });
test('access plan is reconstructed only from frozen snapshot', () => { const s=subscription(); const x=svc.subscriptionPlanAsAccessPlan(s); assert.equal(x.name,s.planSnapshot.name); assert.equal(x.maxStudents,s.planSnapshot.maxStudents); assert.equal(x.isActive,true); });
test('history entries normalize bounded status and reason', () => { const x=svc.historyEntry({action:' suspend ',fromStatus:'ACTIVE',toStatus:'SUSPENDED',reason:'x'.repeat(600),revision:3}); assert.equal(x.action,'suspend'); assert.equal(x.fromStatus,'active'); assert.equal(x.reason.length,500); assert.equal(x.revision,3); });
test('claim tokens are random-shaped and non-repeating', () => { const a=svc.claimToken(),b=svc.claimToken(); assert.match(a,/^[a-f\d]{32}$/); assert.notEqual(a,b); });

test('tenant limit helper treats zero as unlimited', async()=>{ const M={countDocuments:async()=>99}; const x=await checkTenantLimit({model:M,tenantAccess:{limits:{maxStudents:0}},kind:'students'}); assert.equal(x.allowed,true); assert.equal(x.unlimited,true); });
test('tenant limit helper accounts for requested slots', async()=>{ const M={countDocuments:async()=>4}; const x=await checkTenantLimit({model:M,tenantAccess:{limits:{maxStudents:5}},kind:'students',requiredSlots:2}); assert.equal(x.allowed,false); assert.equal(x.remaining,1); });
test('tenant limit assertion emits stable capacity error', async()=>{ const M={countDocuments:async()=>5}; await assert.rejects(assertTenantLimitAvailable({model:M,tenantAccess:{planName:'Starter',limits:{maxStudents:5}},kind:'students'}),e=>e.code==='TENANT_LIMIT_REACHED'&&e.limit===5); });
test('post-create tenant limit race compensates the newly created record', async()=>{ let deleted=null; const M={countDocuments:async()=>6,deleteOne:async(q)=>{deleted=q._id;return{deletedCount:1}}}; const id=oid(); await assert.rejects(compensateIfTenantLimitExceeded({model:M,tenantAccess:{planName:'Starter',limits:{maxStudents:5}},kind:'students',createdId:id}),e=>e.code==='TENANT_LIMIT_REACHED'); assert.equal(String(deleted),String(id)); });
test('post-create tenant limit race fails hard if compensation cannot remove record', async()=>{ const M={countDocuments:async()=>6,deleteOne:async()=>({deletedCount:0})}; await assert.rejects(compensateIfTenantLimitExceeded({model:M,tenantAccess:{limits:{maxStaff:5}},kind:'staff',createdId:oid()}),e=>e.code==='TENANT_LIMIT_COMPENSATION_FAILED'); });
