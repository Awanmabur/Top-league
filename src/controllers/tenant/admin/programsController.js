const {
  normalizeProgramInput,
  programReferenceCounts,
  programReferenceCountsMany,
  updateProgram,
  setProgramStatus,
  deleteProgram,
} = require("../../../services/tenant/organizationCatalogService");

const actorUserId = (req) => req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;
const str = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const escapeRegex = (v) => String(v ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const csv = (v) => { let s = String(v ?? ""); if (/^[=+\-@]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };

function filters(query = {}) {
  const q = str(query.q, 160);
  const status = ["active", "inactive", "archived"].includes(str(query.status).toLowerCase()) ? str(query.status).toLowerCase() : "all";
  const mongo = { isDeleted: { $ne: true } };
  if (status !== "all") mongo.status = status;
  if (q) { const rx = new RegExp(escapeRegex(q), "i"); mongo.$or = [{ name: rx }, { title: rx }, { code: rx }, { description: rx }]; }
  return { mongo, clean: { q, status } };
}

async function rowsWithRefs(req, docs) {
  const refsById = await programReferenceCountsMany(req.models, docs.map((doc) => doc._id));
  return docs.map((doc) => ({
    id: String(doc._id), name: doc.name || doc.title || "", code: doc.code || "", shortTitle: doc.shortTitle || "",
    levelType: doc.levelType || "mixed", classLevels: Array.isArray(doc.classLevels) ? doc.classLevels.join(", ") : "",
    description: doc.description || "", status: doc.status || "inactive", revision: Number(doc.revision || 1),
    refs: refsById.get(String(doc._id)) || { students: 0, invoices: 0, payments: 0, feeStructures: 0, scholarships: 0, scholarshipApplications: 0, total: 0 },
    legacy: Boolean(doc.legacySubjectId), quarantined: Boolean(doc.migrationQuarantinedAt),
  }));
}

module.exports = {
  async index(req, res) {
    const { mongo, clean } = filters(req.query);
    const docs = await req.models.Program.find(mongo).sort({ status: 1, name: 1 }).limit(1000).lean();
    const programs = await rowsWithRefs(req, docs);
    return res.render("tenant/programs/index", { tenant: req.tenant, csrfToken: req.csrfToken?.(), programs, query: clean,
      kpis: { total: programs.length, active: programs.filter(x => x.status === "active").length, referenced: programs.filter(x => x.refs.total > 0).length, quarantined: programs.filter(x => x.quarantined).length },
      messages: { success: req.flash?.("success") || [], error: req.flash?.("error") || [] } });
  },
  async create(req, res) {
    try {
      const data = normalizeProgramInput(req.body);
      await req.models.Program.create({ ...data, createdBy: actorUserId(req), updatedBy: actorUserId(req) });
      req.flash?.("success", "Academic program created.");
    } catch (err) { req.flash?.("error", err?.code === 11000 ? "Program code already exists." : err.message); }
    return res.redirect("/admin/programs");
  },
  async update(req, res) {
    try { await updateProgram(req.models, req.params.id, req.body.revision, req.body, actorUserId(req)); req.flash?.("success", "Academic program updated."); }
    catch (err) { req.flash?.("error", err.message || "Program update failed."); }
    return res.redirect("/admin/programs");
  },
  async status(req, res) {
    try { await setProgramStatus(req.models, req.params.id, req.body.revision, req.body.status, actorUserId(req)); req.flash?.("success", "Program status updated."); }
    catch (err) { req.flash?.("error", err.message || "Program status update failed."); }
    return res.redirect("/admin/programs");
  },
  async delete(req, res) {
    try { await deleteProgram(req.models, req.params.id, req.body.revision, actorUserId(req)); req.flash?.("success", "Program deleted."); }
    catch (err) { req.flash?.("error", err.message || "Program delete failed."); }
    return res.redirect("/admin/programs");
  },
  async exportCsv(req, res) {
    const { mongo } = filters(req.query); const docs = await req.models.Program.find(mongo).sort({ name: 1 }).lean(); const rows = await rowsWithRefs(req, docs);
    const lines = [["Code","Program","Status","Level","Class levels","References","Legacy projection","Quarantined"].map(csv).join(",")];
    rows.forEach(x => lines.push([x.code,x.name,x.status,x.levelType,x.classLevels,x.refs.total,x.legacy?"Yes":"No",x.quarantined?"Yes":"No"].map(csv).join(",")));
    res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", 'attachment; filename="academic-programs.csv"'); return res.send(`\uFEFF${lines.join("\r\n")}`);
  },
};
