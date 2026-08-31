const {
  normalizeDepartmentInput,
  departmentReferenceCounts,
  updateDepartment,
  setDepartmentStatus,
  deleteDepartment,
} = require("../../../services/tenant/organizationCatalogService");

const actorUserId = (req) => req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;
const str = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const escapeRegex = (v) => String(v ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const csv = (v) => { let s = String(v ?? ""); if (/^[=+\-@]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
function filters(query = {}) { const q=str(query.q,160); const status=["active","inactive","archived"].includes(str(query.status).toLowerCase())?str(query.status).toLowerCase():"all"; const mongo={isDeleted:{$ne:true}}; if(status!=="all")mongo.status=status; if(q){const rx=new RegExp(escapeRegex(q),"i");mongo.$or=[{name:rx},{code:rx},{costCenter:rx},{description:rx}];} return {mongo,clean:{q,status}}; }
async function rowsWithRefs(req, docs) { return Promise.all(docs.map(async d=>({ id:String(d._id), name:d.name||"", code:d.code||"", costCenter:d.costCenter||"", description:d.description||"", status:d.status||"inactive", revision:Number(d.revision||1), refs:await departmentReferenceCounts(req.models,d._id), quarantined:Boolean(d.migrationQuarantinedAt) }))); }
module.exports={
 async index(req,res){const {mongo,clean}=filters(req.query);const docs=await req.models.Department.find(mongo).sort({status:1,name:1}).limit(1000).lean();const departments=await rowsWithRefs(req,docs);return res.render("tenant/departments/index",{tenant:req.tenant,csrfToken:req.csrfToken?.(),departments,query:clean,kpis:{total:departments.length,active:departments.filter(x=>x.status==="active").length,referenced:departments.filter(x=>x.refs.total>0).length,quarantined:departments.filter(x=>x.quarantined).length},messages:{success:req.flash?.("success")||[],error:req.flash?.("error")||[]}});},
 async create(req,res){try{const data=normalizeDepartmentInput(req.body);await req.models.Department.create({...data,createdBy:actorUserId(req),updatedBy:actorUserId(req)});req.flash?.("success","Department created.");}catch(err){req.flash?.("error",err?.code===11000?"Department code already exists.":err.message);}return res.redirect("/admin/departments");},
 async update(req,res){try{await updateDepartment(req.models,req.params.id,req.body.revision,req.body,actorUserId(req));req.flash?.("success","Department updated.");}catch(err){req.flash?.("error",err.message||"Department update failed.");}return res.redirect("/admin/departments");},
 async status(req,res){try{await setDepartmentStatus(req.models,req.params.id,req.body.revision,req.body.status,actorUserId(req));req.flash?.("success","Department status updated.");}catch(err){req.flash?.("error",err.message||"Department status update failed.");}return res.redirect("/admin/departments");},
 async delete(req,res){try{await deleteDepartment(req.models,req.params.id,req.body.revision,actorUserId(req));req.flash?.("success","Department deleted.");}catch(err){req.flash?.("error",err.message||"Department delete failed.");}return res.redirect("/admin/departments");},
 async exportCsv(req,res){const {mongo}=filters(req.query);const docs=await req.models.Department.find(mongo).sort({name:1}).lean();const rows=await rowsWithRefs(req,docs);const lines=[["Code","Department","Cost center","Status","Staff","Payroll runs","Payroll items","Quarantined"].map(csv).join(",")];rows.forEach(x=>lines.push([x.code,x.name,x.costCenter,x.status,x.refs.staff,x.refs.payrollRuns,x.refs.payrollItems,x.quarantined?"Yes":"No"].map(csv).join(",")));res.setHeader("Content-Type","text/csv; charset=utf-8");res.setHeader("Content-Disposition",'attachment; filename="departments.csv"');return res.send(`\uFEFF${lines.join("\r\n")}`);}
};
