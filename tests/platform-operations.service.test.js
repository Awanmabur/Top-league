const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'platform-operations-test-secret-123456';

const config = require('../src/services/platformConfigService');
const support = require('../src/services/platformSupportService');
const reports = require('../src/services/platformReportsService');
const directory = require('../src/services/platformPublicDirectoryService');
const audit = require('../src/services/platformAuditService');

// Config
test('platform config normalizes canonical general fields',()=>{const x=config.normalizeGeneral({platform_name:' Classic Academy ',base_domain:'Schools.Example.COM.',default_timezone:'Africa/Kampala',default_currency:'ugx'});assert.deepEqual(x,{platformName:'Classic Academy',baseDomain:'schools.example.com',defaultTimezone:'Africa/Kampala',defaultCurrency:'UGX'});});
test('platform config rejects URL-shaped base domains',()=>assert.throws(()=>config.normalizeDomain('https://school.example.com'),/hostname/i));
test('platform config rejects ports and paths in base domains',()=>{assert.throws(()=>config.normalizeDomain('school.example.com:443'),/hostname/i);assert.throws(()=>config.normalizeDomain('school.example.com/path'),/hostname/i);});
test('platform config rejects invalid timezone',()=>assert.throws(()=>config.normalizeGeneral({platform_name:'Academy',default_timezone:'Mars/Olympus'}),/timezone/i));
test('platform config rejects malformed currency',()=>assert.throws(()=>config.normalizeGeneral({platform_name:'Academy',default_currency:'U$'}),/currency/i));
test('platform branding accepts safe six digit colors and email',()=>assert.deepEqual(config.normalizeBranding({brand_primary_color:'#AABBCC',brand_accent_color:'#001122',brand_support_email:' Help@Example.COM '}),{primaryColor:'#aabbcc',accentColor:'#001122',supportEmail:'help@example.com'}));
test('platform branding rejects CSS payload colors',()=>assert.throws(()=>config.normalizeBranding({brand_primary_color:'red;url(x)'}),/six-digit/i));
test('platform branding rejects malformed support email',()=>assert.throws(()=>config.normalizeBranding({brand_support_email:'bad@@mail'}),/email/i));
test('platform security enforces password minimum bounds',()=>{assert.throws(()=>config.normalizeSecurity({password_min_length:9,session_timeout_minutes:120}),/between 10 and 128/i);assert.equal(config.normalizeSecurity({password_min_length:128,session_timeout_minutes:120}).passwordMinLength,128);});
test('platform security enforces session timeout bounds',()=>{assert.throws(()=>config.normalizeSecurity({password_min_length:10,session_timeout_minutes:14}),/between 15 and 1440/i);assert.equal(config.normalizeSecurity({password_min_length:10,session_timeout_minutes:1440}).sessionTimeoutMinutes,1440);});
test('platform security boolean accepts checkbox vocabulary',()=>{assert.equal(config.normalizeSecurity({require_superadmin_email_2fa:'on'}).requireSuperadminEmail2fa,true);assert.equal(config.normalizeSecurity({require_superadmin_email_2fa:''}).requireSuperadminEmail2fa,false);});
test('flattened config preserves legacy view keys without losing canonical values',()=>{const x=config.flattenConfig({general:{platformName:'X'},security:{requireSuperadminEmail2fa:true}});assert.equal(x.platform_name,'X');assert.equal(x.require_superadmin_email_2fa,true);assert.equal(x.allow_superadmin_2fa,true);});

// Support
test('support ticket numbers are date scoped and cryptographic-shaped',()=>{const a=support.ticketNumber(new Date('2026-08-30T00:00:00Z'));const b=support.ticketNumber(new Date('2026-08-30T00:00:00Z'));assert.match(a,/^TKT-20260830-[A-F0-9]{10}$/);assert.notEqual(a,b);});
test('support normalizes valid statuses and falls back conservatively',()=>{assert.equal(support.normalizeStatus(' RESOLVED '),'resolved');assert.equal(support.normalizeStatus('garbage'),'open');});
test('support normalizes priority and category conservatively',()=>{assert.equal(support.normalizePriority('URGENT'),'urgent');assert.equal(support.normalizePriority('x'),'medium');assert.equal(support.normalizeCategory('feature_request'),'feature_request');assert.equal(support.normalizeCategory('x'),'technical');});
test('support requester email is lowercased and validated',()=>{assert.equal(support.validateRequesterEmail(' User@Example.COM '),'user@example.com');assert.throws(()=>support.validateRequesterEmail('bad@'),/invalid/i);});
test('support revision requires a positive integer',()=>{assert.equal(support.positiveRevision('3'),3);assert.throws(()=>support.positiveRevision(0),/positive revision/i);assert.throws(()=>support.positiveRevision('1.2'),/positive revision/i);});
test('support lifecycle permits open to pending resolved or closed',()=>{for(const x of ['pending','resolved','closed'])assert.equal(support.assertStatusTransition('open',x),true);});
test('support lifecycle permits resolved reopen or close only',()=>{assert.equal(support.assertStatusTransition('resolved','open'),true);assert.equal(support.assertStatusTransition('resolved','closed'),true);assert.throws(()=>support.assertStatusTransition('resolved','pending'),/cannot move/i);});
test('support lifecycle closed can only reopen',()=>{assert.equal(support.assertStatusTransition('closed','open'),true);assert.throws(()=>support.assertStatusTransition('closed','resolved'),/cannot move/i);});
test('support same-state transition is idempotent',()=>assert.equal(support.assertStatusTransition('pending','pending'),true));
test('support status dates stamp resolution and closure',()=>{const now=new Date('2026-08-30T10:00:00Z');assert.equal(support.statusDates('open','resolved',{},now).resolvedAt.toISOString(),now.toISOString());assert.equal(support.statusDates('resolved','closed',{},now).closedAt.toISOString(),now.toISOString());});
test('support reopen clears terminal timestamps',()=>assert.deepEqual(support.statusDates('closed','open',{resolvedAt:new Date(),closedAt:new Date()}),{resolvedAt:null,closedAt:null}));

// Reports
test('platform reports count canonical effective subscription statuses',()=>{const now=new Date('2026-08-30T00:00:00Z');const rows=[{status:'trial',trialEndsAt:new Date('2026-09-01')},{status:'active',currentPeriodEnd:new Date('2026-09-01')},{status:'active',currentPeriodEnd:new Date('2026-08-01')},{status:'cancelled'}];const x=reports.summarizeSubscriptions(rows,now);assert.equal(x.trial,1);assert.equal(x.active,1);assert.equal(x.past_due,1);assert.equal(x.cancelled,1);});
test('platform revenue ignores pending payments',()=>assert.equal(reports.paymentRevenueAmount({status:'pending',type:'school_subscription',amount:10}),0));
test('platform revenue counts completed subscription inflow',()=>assert.equal(reports.paymentRevenueAmount({status:'completed',type:'school_subscription',amount:10}),10));
test('platform revenue subtracts completed refunds',()=>assert.equal(reports.paymentRevenueAmount({status:'completed',type:'refund',amount:10}),-10));
test('platform revenue ignores credit bookkeeping type',()=>assert.equal(reports.paymentRevenueAmount({status:'completed',type:'credit',amount:10}),0));
test('platform net revenue combines inflow and refunds',()=>assert.equal(reports.netRevenue([{status:'completed',type:'manual_adjust',amount:20},{status:'completed',type:'refund',amount:5}]),15));
test('platform report CSV neutralizes formulas',()=>assert.match(reports.csvCell('=HYPERLINK("x")'),/^"'=/));
test('platform report CSV escapes quotes and CRLF terminates rows',()=>{const x=reports.csv([['a"b','c']]);assert.equal(x,'"a""b","c"\r\n');});

// Directory
test('trial tenant is operational only before trial end',()=>{const now=new Date('2026-08-30');assert.equal(directory.tenantProjectionIsOperational({status:'trial',trialEndsAt:new Date('2026-08-31')},now),true);assert.equal(directory.tenantProjectionIsOperational({status:'trial',trialEndsAt:new Date('2026-08-29')},now),false);});
test('active tenant is operational only before paid-through end',()=>{const now=new Date('2026-08-30');assert.equal(directory.tenantProjectionIsOperational({status:'active',subscriptionEndsAt:new Date('2026-09-30')},now),true);assert.equal(directory.tenantProjectionIsOperational({status:'active',subscriptionEndsAt:new Date('2026-08-30')},now),false);});
test('suspended cancelled and deleted tenants are never public-operational',()=>{for(const status of ['suspended','cancelled','deleted','past_due'])assert.equal(directory.tenantProjectionIsOperational({status,subscriptionEndsAt:new Date('2030-01-01')},new Date('2026-08-30')),false);assert.equal(directory.tenantProjectionIsOperational({status:'active',subscriptionEndsAt:new Date('2030-01-01'),isDeleted:true},new Date('2026-08-30')),false);});
test('operational directory mongo filter includes trial and active expiry predicates',()=>{const x=directory.operationalTenantProjectionFilter(new Date('2026-08-30'));assert.equal(x.$or.length,2);assert.equal(x.$or[0].status,'trial');assert.equal(x.$or[1].status,'active');assert.ok(x.$or[0].trialEndsAt.$gt);assert.ok(x.$or[1].subscriptionEndsAt.$gt);});
test('operational condition composes rather than replacing existing filter',()=>{const x=directory.addOperationalTenantCondition({name:'A'},new Date('2026-08-30'));assert.equal(x.$and.length,2);assert.deepEqual(x.$and[0],{name:'A'});assert.ok(x.$and[1].$or);});

// Audit privacy
test('audit masks IPv4 and returns keyed hash',()=>{const x=audit.sanitizeAuditFields({ipAddress:'10.20.30.40'});assert.equal(x.ipAddress,'10.20.30.0');assert.match(x.ipHash,/^[a-f0-9]{64}$/);});
test('audit masks IPv6 prefix',()=>assert.match(audit.maskIp('2001:db8:1:2:3:4:5:6'),/^2001:db8:1:2::$/));
test('audit recursive redaction removes nested secrets',()=>{const x=audit.redactAuditValue({safe:'x',nested:{apiKey:'secret',password:'p'},token:'t'});assert.equal(x.safe,'x');assert.equal(x.nested.apiKey,'[REDACTED]');assert.equal(x.nested.password,'[REDACTED]');assert.equal(x.token,'[REDACTED]');});
test('audit redaction bounds deep recursion',()=>{let x={};let cur=x;for(let i=0;i<10;i++){cur.next={};cur=cur.next;}const y=audit.redactAuditValue(x);assert.match(JSON.stringify(y),/TRUNCATED/);});
test('audit hashes are label separated',()=>assert.notEqual(audit.privacyHmac('a','same'),audit.privacyHmac('b','same')));
