const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");
const svc = require("../src/services/tenant/organizationCatalogService");
const migration = require("../scripts/lib/migrateOrganizationCatalog");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const oid = () => new mongoose.Types.ObjectId();
function query(result) { return { select(){return this;}, sort(){return this;}, limit(){return this;}, lean(){return Promise.resolve(result);}, catch(fn){return Promise.resolve(result).catch(fn);} }; }

test("program input normalizes code, title and class levels", () => {
  const x = svc.normalizeProgramInput({ name:"  Lower Secondary  ", code:"lower sec & arts", classLevels:"s1, s2, S1", levelType:"SECONDARY" });
  assert.equal(x.code,"LOWER-SEC-AND-ARTS"); assert.equal(x.title,"Lower Secondary"); assert.deepEqual(x.classLevels,["S1","S2"]); assert.equal(x.levelType,"secondary");
});
test("program input requires a name", () => assert.throws(()=>svc.normalizeProgramInput({code:"X"}),/name and code/i));
test("department input normalizes code and status", () => { const x=svc.normalizeDepartmentInput({name:"Human Resources",status:"ACTIVE"}); assert.equal(x.code,"HUMAN-RESOURCES"); assert.equal(x.status,"active"); });
test("revision parser rejects missing and stale-shaped values", () => { assert.throws(()=>svc.parseRevision(""),/revision/i); assert.throws(()=>svc.parseRevision(0),/revision/i); assert.equal(svc.parseRevision("3"),3); });
test("active program lookup fails closed without model", async()=>await assert.rejects(svc.assertActiveProgram(null,oid()),/Invalid academic program/));
test("active program lookup rejects inactive/unavailable rows", async()=>{const P={findOne:()=>query(null)};await assert.rejects(svc.assertActiveProgram(P,oid()),/inactive or unavailable/);});
test("active program lookup returns canonical id", async()=>{const id=oid();const P={findOne:()=>query({_id:id})};assert.equal(String(await svc.assertActiveProgram(P,id)),String(id));});
test("active department lookup rejects unavailable rows", async()=>{const D={findOne:()=>query(null)};await assert.rejects(svc.assertActiveDepartment(D,oid()),/inactive or unavailable/);});
test("active department lookup returns canonical id", async()=>{const id=oid();const D={findOne:()=>query({_id:id})};assert.equal(String(await svc.assertActiveDepartment(D,id)),String(id));});
test("inactive Program may be retained on the same historical record but not newly assigned", async()=>{const pid=oid();let calls=0;const P={findOne:(filter)=>{calls++;return query(filter.status===undefined?{_id:pid}:null);}};assert.equal(String(await svc.assertProgramAssignment(P,pid,pid)),String(pid));await assert.rejects(svc.assertProgramAssignment(P,pid,oid()),/inactive or unavailable/);assert.equal(calls,2);});
test("inactive Department may be retained on the same historical record but not newly assigned", async()=>{const did=oid();const D={findOne:(filter)=>query(filter.status===undefined?{_id:did}:null)};assert.equal(String(await svc.assertDepartmentAssignment(D,did,did)),String(did));await assert.rejects(svc.assertDepartmentAssignment(D,did,oid()),/inactive or unavailable/);});
test("program reference counts aggregate every canonical consumer", async()=>{const M=(n)=>({countDocuments:async()=>n});const c=await svc.programReferenceCounts({Student:M(1),Invoice:M(2),Payment:M(3),FeeStructure:M(4),Scholarship:M(5),ScholarshipApplication:M(6)},oid());assert.equal(c.total,21);assert.equal(c.scholarshipApplications,6);});
test("department reference counts aggregate staff and payroll", async()=>{const M=(n)=>({countDocuments:async()=>n});const c=await svc.departmentReferenceCounts({Staff:M(2),PayrollRun:M(3),PayrollItem:M(4)},oid());assert.equal(c.total,9);});
test("program update is revision guarded and increments revision", async()=>{let filter,update;const id=oid();const models={Program:{findOneAndUpdate:async(f,u)=>{filter=f;update=u;return {_id:id};}}};await svc.updateProgram(models,id,4,{name:"Primary",code:"PRI",status:"active"});assert.equal(filter.revision,4);assert.equal(update.$inc.revision,1);});
test("program stale revision returns conflict", async()=>{const models={Program:{findOneAndUpdate:async()=>null}};await assert.rejects(svc.updateProgram(models,oid(),1,{name:"A",code:"A",status:"active"}),/another session/);});
test("department update is revision guarded", async()=>{let filter;const models={Department:{findOneAndUpdate:async(f)=>{filter=f;return {_id:f._id};}}};await svc.updateDepartment(models,oid(),2,{name:"Finance",code:"FIN",status:"active"});assert.equal(filter.revision,2);});
test("referenced program cannot be archived", async()=>{const M={countDocuments:async()=>1};await assert.rejects(svc.setProgramStatus({Program:{},Student:M},oid(),1,"archived"),/cannot be archived/);});
test("referenced department cannot be archived", async()=>{const M={countDocuments:async()=>1};await assert.rejects(svc.setDepartmentStatus({Department:{},Staff:M},oid(),1,"archived"),/cannot be archived/);});
test("referenced program cannot be deleted", async()=>{const M={countDocuments:async()=>1};await assert.rejects(svc.deleteProgram({Program:{},Invoice:M},oid(),1),/cannot be deleted/);});
test("referenced department cannot be deleted", async()=>{const M={countDocuments:async()=>1};await assert.rejects(svc.deleteDepartment({Department:{},PayrollItem:M},oid(),1),/cannot be deleted/);});
test("unreferenced program soft delete is CAS guarded", async()=>{let update;const P={findOneAndUpdate:async(f,u)=>{update=u;return {_id:f._id};}};await svc.deleteProgram({Program:P},oid(),2);assert.equal(update.$set.isDeleted,true);assert.equal(update.$set.status,"archived");assert.equal(update.$inc.revision,1);});
test("unreferenced department soft delete is CAS guarded", async()=>{let update;const D={findOneAndUpdate:async(f,u)=>{update=u;return {_id:f._id};}};await svc.deleteDepartment({Department:D},oid(),2);assert.equal(update.$set.isDeleted,true);assert.equal(update.$inc.revision,1);});

test("tenant loader registers Program and Department",()=>{const s=read("src/models/tenant/loadModels.js");assert.match(s,/Program:\s*defineModel\("Program"\)/);assert.match(s,/Department:\s*defineModel\("Department"\)/);});
test("finance and scholarship program refs are canonical Program refs",()=>{for(const f of ["Invoice.js","Payment.js","FeeStructure.js","Scholarship.js","ScholarshipApplication.js"]){const s=read(`src/models/tenant/${f}`);assert.match(s,/ref:\s*["']Program["']/);}});
test("Student has canonical Program reference",()=>assert.match(read("src/models/tenant/Student.js"),/programId:[^\n]*ref:\s*["']Program["']/));
test("Staff and payroll models use canonical Department refs",()=>{for(const f of ["Staff.js","PayrollRun.js","PayrollItem.js"])assert.match(read(`src/models/tenant/${f}`),/departmentId:[^\n]*ref:\s*["']Department["']/);});
test("admin mounts Program and Department catalog routes",()=>{const s=read("src/routes/tenant/admin/index.js");assert.match(s,/router\.use\("\/programs"/);assert.match(s,/router\.use\("\/departments"/);});
test("finance routes fail closed when Program model is unavailable",()=>{const s=read("src/routes/tenant/admin/index.js");for(const route of ["finance","invoices","payments","student-statements","fees","fee-structures","scholarships","finance-reports"]){const line=s.split("\n").find((row)=>row.includes(`router.use("/${route}"`))||"";assert.match(line,/requireTenantModels/);assert.match(line,/"Program"/);}});
test("Staff and payroll routes fail closed when Department is unavailable",()=>{const s=read("src/routes/tenant/admin/index.js");assert.match(s,/router\.use\("\/staff"[^\n]*\["Department"\]/);assert.match(s,/"\/payroll"[\s\S]*?\["Department"\]/);});
test("Staff admin validates department through canonical active lookup",()=>{const s=read("src/controllers/tenant/admin/staffController.js");assert.match(s,/assertActiveDepartment/);assert.doesNotMatch(s,/departmentId\s*=\s*isValidId\(req\.body\.departmentId\)/);});
test("Staff self-service cannot reassign Department",()=>{const s=read("src/controllers/tenant/staff/profileController.js");assert.doesNotMatch(s,/req\.body\.departmentId/);assert.doesNotMatch(s,/Department\s*}/);});
test("Payroll service validates scoped Department before creating run",()=>{const s=read("src/services/tenant/payrollService.js");assert.match(s,/assertActiveDepartment\(models\.Department/);});
test("FeeStructure validates Program rather than historical Subject alias",()=>{const s=read("src/services/tenant/feeStructureService.js");assert.match(s,/assertProgramAssignment\(models\.Program/);assert.doesNotMatch(s,/assertReference\(models\.Subject, payload\.programId/);});
test("Invoice and payment mutations validate active Program",()=>{assert.match(read("src/controllers/tenant/admin/invoicesController.js"),/assertActiveProgram/);assert.match(read("src/controllers/tenant/admin/paymentsController.js"),/assertProgramAssignment/);assert.match(read("src/services/tenant/financeService.js"),/assertActiveProgram/);});
test("Scholarship admin and public application validate active Program",()=>{assert.match(read("src/controllers/tenant/admin/scholarshipsController.js"),/assertActiveProgram/);assert.match(read("src/controllers/tenant/public/scholarshipsPublicController.js"),/assertActiveProgram/);});
test("catalog views include CSRF and revision tokens and avoid data-backed innerHTML",()=>{for(const f of ["views/tenant/programs/index.ejs","views/tenant/departments/index.ejs"]){const s=read(f);assert.match(s,/name="_csrf"/);assert.match(s,/name="revision"/);assert.doesNotMatch(s,/innerHTML|insertAdjacentHTML/);}});
test("main admin navigation exposes Programs and Departments",()=>{const s=read("views/tenant/partials/navbar.ejs");assert.match(s,/href:\s*"\/admin\/programs"/);assert.match(s,/href:\s*"\/admin\/departments"/);});

test("migration projects legacy Subject to Program with the same ObjectId",async()=>{
  const legacy=oid(); const created=[]; const store=new Set();
  const Program={exists:async({ _id })=>store.has(String(_id)),findOne:()=>query(null),create:async(d)=>{created.push(d);store.add(String(d._id));return d;}};
  const Subject={findById:()=>({lean:()=>Promise.resolve({_id:legacy,title:"Legacy Program",code:"LP",status:"active",levelType:"secondary",classLevel:"S4"})})};
  const Invoice={distinct:async()=>[legacy]};
  const stats={programReferences:0,programsProjectedFromSubjects:0,programsQuarantined:0};
  await migration.migratePrograms({Program,Subject,Invoice},stats);
  assert.equal(String(created[0]._id),String(legacy));assert.equal(String(created[0].legacySubjectId),String(legacy));assert.equal(created[0].status,"active");assert.equal(stats.programsProjectedFromSubjects,1);
});
test("migration quarantines unresolved historical Program IDs",async()=>{
  const legacy=oid(); const created=[];
  const Program={exists:async()=>false,findOne:()=>query(null),create:async(d)=>{created.push(d);return d;}};
  const Subject={findById:()=>({lean:()=>Promise.resolve(null)})}; const Payment={distinct:async()=>[legacy]}; const stats={programReferences:0,programsProjectedFromSubjects:0,programsQuarantined:0};
  await migration.migratePrograms({Program,Subject,Payment},stats);assert.equal(created[0].status,"inactive");assert.ok(created[0].migrationQuarantinedAt);assert.equal(stats.programsQuarantined,1);
});
test("Program migration is idempotent after same-ID projection",async()=>{
  const legacy=oid();let creates=0;const store=new Set();const Program={exists:async({_id})=>store.has(String(_id)),findOne:()=>query(null),create:async(d)=>{creates++;store.add(String(d._id));return d;}};const Subject={findById:()=>({lean:()=>Promise.resolve({_id:legacy,title:"P",code:"P",status:"active"})})};const Invoice={distinct:async()=>[legacy]};
  for(let i=0;i<2;i++)await migration.migratePrograms({Program,Subject,Invoice},{programReferences:0,programsProjectedFromSubjects:0,programsQuarantined:0});assert.equal(creates,1);
});
test("migration creates same-ID quarantined Department for unresolved payroll references",async()=>{
  const legacy=oid();const created=[];const Department={exists:async()=>false,findOne:()=>query(null),create:async(d)=>{created.push(d);return d;}};const PayrollItem={distinct:async()=>[legacy],findOne:()=>query({departmentName:"Legacy Accounts"})};const stats={departmentReferences:0,departmentsQuarantined:0};await migration.migrateReferencedDepartments({Department,PayrollItem},stats);assert.equal(String(created[0]._id),String(legacy));assert.equal(created[0].name,"Legacy Accounts");assert.equal(created[0].status,"inactive");
});
test("migration is wired before scholarship/finance migrations and before index creation",()=>{const s=read("scripts/create-indexes.js");const org=s.indexOf("migrateOrganizationCatalog(tenantModels)");const scholarships=s.indexOf("migrateScholarships(tenantModels)");const indexes=s.indexOf("createModelIndexes(label, tenantModels)");assert.ok(org>0&&org<scholarships&&scholarships<indexes);});
test("organization migration has a package script",()=>{const pkg=JSON.parse(read("package.json"));assert.equal(pkg.scripts["migrate:organization-catalog"],"node scripts/migrate-organization-catalog.js");});
test("catalog EJS templates compile",()=>{const ejs=require("ejs");for(const f of ["views/tenant/programs/index.ejs","views/tenant/departments/index.ejs"])assert.doesNotThrow(()=>ejs.compile(read(f),{filename:path.join(root,f)}));});
