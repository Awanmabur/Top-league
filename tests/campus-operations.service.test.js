const test=require('node:test');const assert=require('node:assert/strict');
const transport=require('../src/services/tenant/transportService');
const asset=require('../src/services/tenant/assetService');
const facility=require('../src/services/tenant/facilityService');

// Transport

test('transport route codes and pickup points normalize deterministically',()=>{assert.equal(transport.routeCode(' bus / north  1 '),'BUS-NORTH-1');assert.deepEqual(transport.pickupPoints('Gate A, Gate A\nGate B'),['Gate A','Gate B']);});
test('transport committed seats include real assignments and legacy reservations',()=>{assert.equal(transport.committedSeats({legacyAssignedLearners:3},4),7);});
test('transport capacity cannot fall below committed seats',()=>{assert.throws(()=>transport.assertCapacity(4,5),/committed learner seats/);assert.equal(transport.assertCapacity(5,5),5);});
test('archived transport routes cannot be reactivated',()=>{assert.throws(()=>transport.assertTransition({status:'archived'},'active'),/immutable/);});
test('route values require identity and preserve first activation',()=>{const now=new Date('2026-08-29T10:00:00Z');const v=transport.buildRouteValues({input:{routeName:'North','routeCode':'n-1',capacity:10,status:'active',pickupPoints:'A'},now});assert.equal(v.routeCode,'N-1');assert.equal(String(v.firstActivatedAt),String(now));assert.throws(()=>transport.buildRouteValues({input:{capacity:1}}),/required/);});
test('only active routes and active students can be assigned',()=>{assert.throws(()=>transport.assertAssignableRoute({status:'inactive'}),/active transport route/);assert.throws(()=>transport.assertStudentAssignable({status:'suspended'}),/active student/);});
test('pickup assignment must match route pickup list case-insensitively',()=>{assert.equal(transport.normalizePickupForRoute({pickupPoints:['Gate A']},'gate a'),'Gate A');assert.throws(()=>transport.normalizePickupForRoute({pickupPoints:['Gate A']},'Gate B'),/not part/);});
test('transport assignment snapshots fee and student identity',()=>{const now=new Date();const v=transport.buildAssignmentValues({route:{_id:'r',status:'active',pickupPoints:['A'],feeAmount:5000},student:{_id:'s',status:'active',regNo:'REG1',fullName:'Learner'},pickupPoint:'A',now});assert.equal(v.status,'active');assert.equal(v.studentRegNo,'REG1');assert.equal(v.feeAmountSnapshot,5000);});
test('transport assignment ending increments revision',()=>{const v=transport.endAssignmentValues({status:'active',revision:3});assert.equal(v.status,'ended');assert.equal(v.revision,4);assert.throws(()=>transport.endAssignmentValues({status:'ended'}),/Only an active/);});
test('permanent transport delete is only for never-used inactive draft',()=>{assert.equal(transport.assertDeleteAllowed({status:'inactive',legacyAssignedLearners:0},0),true);assert.throws(()=>transport.assertDeleteAllowed({status:'active'},0),/never-activated/);assert.throws(()=>transport.assertDeleteAllowed({status:'inactive',firstActivatedAt:new Date()},0),/never-activated/);});
test('transport CSV cells neutralize spreadsheet formulas',()=>{assert.equal(transport.csvCell('=1+1'),'"\'=1+1"');});
test('transport assignment codes are nonsequential and dated',()=>{const a=transport.newAssignmentCode(new Date('2026-08-29T00:00:00Z')),b=transport.newAssignmentCode(new Date('2026-08-29T00:00:00Z'));assert.match(a,/^TR-20260829-[A-F0-9]{8}$/);assert.notEqual(a,b);});

// Assets

test('asset assigned quantity sums only live assignments',()=>{assert.equal(asset.assignedQuantity({assignments:[{status:'Assigned',quantity:2},{status:'Returned',quantity:9},{status:'Assigned',quantity:1,returnedAt:new Date()}]}),2);});
test('asset quantity cannot be reduced below issued units',()=>{const current={status:'Assigned',quantity:5,assignments:[{status:'Assigned',quantity:3}]};assert.throws(()=>asset.buildAssetValues({input:{assetTag:'A',name:'Desk',quantity:2},current}),/currently assigned/);});
test('asset assignment enforces free quantity and blocks maintenance',()=>{assert.equal(asset.assertAssignmentAllowed({status:'Available',quantity:3,assignments:[{status:'Assigned',quantity:1}]},2),2);assert.throws(()=>asset.assertAssignmentAllowed({status:'Maintenance',quantity:3,assignments:[]},1),/maintenance/);assert.throws(()=>asset.assertAssignmentAllowed({status:'Available',quantity:1,assignments:[]},2),/exceeds/);});
test('asset canonical assignment records assignee id and quantity',()=>{const a=asset.newAssignment({assignedTo:'Jane',assigneeType:'Student',assigneeId:'s1',quantity:2});assert.equal(a.assigneeId,'s1');assert.equal(a.quantity,2);assert.equal(a.status,'Assigned');});
test('asset status derives from disposal maintenance and assignments',()=>{assert.equal(asset.deriveAssetStatus({disposedAt:new Date(),assignments:[]}), 'Disposed');assert.equal(asset.deriveAssetStatus({assignments:[]},{openMaintenance:true}),'Maintenance');assert.equal(asset.deriveAssetStatus({assignments:[{status:'Assigned',quantity:1}]}),'Assigned');assert.equal(asset.deriveAssetStatus({assignments:[]}),'Available');});
test('asset maintenance requires all units returned',()=>{assert.throws(()=>asset.assertMaintenanceOpenAllowed({status:'Assigned',assignments:[{status:'Assigned',quantity:1}]}),/Return all assigned/);assert.equal(asset.assertMaintenanceOpenAllowed({status:'Available',assignments:[]}),true);});
test('asset disposal requires no assignments and no open maintenance',()=>{assert.throws(()=>asset.assertDisposeAllowed({status:'Assigned',assignments:[{status:'Assigned',quantity:1}]}),/Return all assigned/);assert.throws(()=>asset.assertDisposeAllowed({status:'Available',assignments:[]},{openMaintenance:true}),/Resolve open maintenance/);});
test('maintenance tickets are revisioned and terminal states immutable',()=>{const v=asset.maintenanceValues({asset:{_id:'a',status:'Available',assignments:[]},input:{title:'Tyre',status:'open'}});assert.match(v.ticketCode,/^MT-\d{8}-[A-F0-9]{8}$/);assert.equal(v.revision,1);assert.throws(()=>asset.maintenanceValues({asset:{_id:'a'},current:{asset:'a',title:'x',status:'resolved',revision:2,ticketCode:'MT-1'},input:{status:'open'}}),/immutable/);});
test('asset CSV cells neutralize formula payloads',()=>{assert.equal(asset.csvCell('@SUM(A1:A2)'),'"\'@SUM(A1:A2)"');});

// Facilities

test('classroom codes and room keys normalize',()=>{assert.equal(facility.code('lab / 1'),'LAB-1');assert.equal(facility.roomKey('  Science   Lab '),'science lab');});
test('classroom capacity must be positive',()=>{assert.throws(()=>facility.buildClassroomValues({input:{name:'Lab',code:'L1',capacity:0}}),/at least 1/);});
test('maintenance classrooms require a reason',()=>{assert.throws(()=>facility.buildClassroomValues({input:{name:'Lab',code:'L1',capacity:20,status:'maintenance'}}),/reason is required/);});
test('archived classrooms cannot return to service',()=>{assert.throws(()=>facility.assertTransition({status:'archived'},'available'),/immutable/);});
test('published timetable usage blocks facility shutdown',()=>{assert.throws(()=>facility.assertStatusChangeAllowed({status:'available'},'maintenance',1),/published timetable/);assert.equal(facility.assertStatusChangeAllowed({status:'available'},'maintenance',0),'maintenance');});
test('registered unavailable classrooms cannot host published timetable',()=>{assert.throws(()=>facility.assertRoomSchedulable({status:'maintenance'}),/not available/);assert.equal(facility.assertRoomSchedulable({status:'available'}),true);assert.equal(facility.assertRoomSchedulable(null),true);});
test('facility timetable usage uses global normalized room identity',()=>{assert.deepEqual(facility.activeTimetableFilter({roomKey:' Lab 1 '}),{status:'active',migrationQuarantinedAt:null,roomKey:'lab 1'});});
test('Student and Staff asset assignments require canonical profile ids',()=>{assert.throws(()=>asset.newAssignment({assignedTo:'Free text',assigneeType:'Student'}),/canonical profile/);assert.throws(()=>asset.newAssignment({assignedTo:'Free text',assigneeType:'Staff'}),/canonical profile/);assert.equal(asset.newAssignment({assignedTo:'Science Department',assigneeType:'Department'}).assigneeType,'Department');});
