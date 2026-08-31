const {
  str,
  isValidId,
  escapeRegex,
  actorId,
  parsePayload,
  validatePayload,
  validateReferences,
  createStructure,
  csvCell,
  serialize,
} = require("../../../services/tenant/feeStructureService");

function getName(doc) {
  return doc?.title || doc?.shortTitle || doc?.name || doc?.code || "—";
}

function buildFilter(query = {}) {
  const q = str(query.q, 120);
  const status = str(query.status || "all", 20);
  const program = str(query.program || "all", 80);
  const academicYear = str(query.academicYear || "all", 40);
  const mongo = { isDeleted: { $ne: true } };
  if (["Active", "Inactive", "Archived"].includes(status)) mongo.status = status;
  if (program !== "all" && isValidId(program)) mongo.programId = program;
  if (academicYear !== "all") mongo.academicYear = academicYear;
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    mongo.$or = [
      { structureCode: rx }, { name: rx }, { academicYear: rx }, { term: rx }, { notes: rx },
      { "items.title": rx }, { "items.category": rx },
    ];
  }
  return { mongo, clean: { q, status, program, academicYear } };
}

async function findStructure(FeeStructure, id) {
  if (!isValidId(id)) return null;
  return FeeStructure.findOne({ _id: id, isDeleted: { $ne: true } });
}

async function renderIndex(req, res) {
  const { FeeStructure, Program, Subject, Class, Intake } = req.models;
  const AcademicProgram = Program || Subject || null;
  if (!FeeStructure) return res.status(500).send("FeeStructure model is unavailable.");
  const { mongo, clean } = buildFilter(req.query);
  const [docs, allDocs, programs, classes, intakes, years] = await Promise.all([
    FeeStructure.find(mongo)
      .populate("programId", "title shortTitle name code")
      .populate("classId", "name code classLevel")
      .populate("intakeId", "name code")
      .sort({ updatedAt: -1, _id: -1 }).limit(2000).lean(),
    FeeStructure.find({ isDeleted: { $ne: true } }).select("status totalAmount itemsCount").lean(),
    AcademicProgram ? AcademicProgram.find({ isDeleted: { $ne: true }, status: { $ne: "archived" } }).select("title shortTitle name code status").sort({ title: 1, name: 1, code: 1 }).limit(4000).lean() : [],
    Class ? Class.find({ status: { $ne: "archived" } }).select("name code classLevel").sort({ name: 1 }).limit(4000).lean() : [],
    Intake ? Intake.find({ isDeleted: { $ne: true } }).select("name code status").sort({ createdAt: -1 }).limit(1000).lean() : [],
    FeeStructure.distinct("academicYear", { isDeleted: { $ne: true }, academicYear: { $nin: [null, ""] } }),
  ]);
  const feeStructures = docs.map(serialize);
  const kpis = {
    total: allDocs.length,
    active: allDocs.filter((x) => x.status === "Active").length,
    inactive: allDocs.filter((x) => x.status === "Inactive").length,
    archived: allDocs.filter((x) => x.status === "Archived").length,
    totalAmount: allDocs.reduce((sum, x) => sum + Number(x.totalAmount || 0), 0),
    items: allDocs.reduce((sum, x) => sum + Number(x.itemsCount || 0), 0),
  };
  return res.render("tenant/finance/fee-structures", {
    tenant: req.tenant,
    csrfToken: req.csrfToken?.() || res.locals.csrfToken || null,
    feeStructures,
    programs: (programs || []).map((x) => ({ id: String(x._id), name: getName(x) })),
    classes: (classes || []).map((x) => ({ id: String(x._id), name: getName(x) })),
    intakes: (intakes || []).map((x) => ({ id: String(x._id), name: getName(x) })),
    years: [...new Set((years || []).filter(Boolean).map(String))].sort().reverse(),
    kpis,
    query: clean,
    messages: {
      success: req.flash ? req.flash("success") : [],
      error: req.flash ? req.flash("error") : [],
    },
  });
}

async function validatedPayload(req, currentProgramId = null) {
  const payload = validatePayload(parsePayload(req.body));
  await validateReferences(req.models, payload, currentProgramId);
  return payload;
}

module.exports = {
  index: renderIndex,
  list: renderIndex,

  create: async (req, res) => {
    try {
      const { FeeStructure } = req.models;
      if (!FeeStructure) throw new Error("FeeStructure model is unavailable.");
      const payload = await validatedPayload(req);
      await createStructure(FeeStructure, { ...payload, createdBy: actorId(req), updatedBy: actorId(req) });
      req.flash?.("success", "Fee structure created.");
    } catch (err) {
      req.flash?.("error", err?.message || "Failed to create fee structure.");
    }
    return res.redirect("/admin/fee-structures");
  },

  update: async (req, res) => {
    try {
      const { FeeStructure } = req.models;
      const doc = await findStructure(FeeStructure, req.params.id);
      if (!doc) throw new Error("Fee structure not found.");
      const payload = await validatedPayload(req, doc.programId);
      Object.assign(doc, payload, { updatedBy: actorId(req) });
      if (payload.status === "Archived") doc.archivedBy = actorId(req);
      await doc.save();
      req.flash?.("success", "Fee structure updated.");
    } catch (err) {
      req.flash?.("error", err?.message || "Failed to update fee structure.");
    }
    return res.redirect("/admin/fee-structures");
  },

  setStatus: async (req, res, status) => {
    try {
      const { FeeStructure } = req.models;
      const doc = await findStructure(FeeStructure, req.params.id);
      if (!doc) throw new Error("Fee structure not found.");
      doc.status = status;
      doc.updatedBy = actorId(req);
      doc.archivedBy = status === "Archived" ? actorId(req) : null;
      await doc.save();
      req.flash?.("success", `Fee structure moved to ${status}.`);
    } catch (err) {
      req.flash?.("error", err?.message || "Failed to update fee structure status.");
    }
    return res.redirect("/admin/fee-structures");
  },

  activate: (req, res) => module.exports.setStatus(req, res, "Active"),
  inactive: (req, res) => module.exports.setStatus(req, res, "Inactive"),
  archive: (req, res) => module.exports.setStatus(req, res, "Archived"),

  remove: async (req, res) => {
    try {
      const { FeeStructure } = req.models;
      const doc = await findStructure(FeeStructure, req.params.id);
      if (!doc) throw new Error("Fee structure not found.");
      await FeeStructure.updateOne({ _id: doc._id, isDeleted: { $ne: true } }, {
        $set: { isDeleted: true, deletedAt: new Date(), deletedBy: actorId(req), status: "Archived", archivedAt: doc.archivedAt || new Date(), archivedBy: doc.archivedBy || actorId(req), updatedBy: actorId(req) },
      });
      req.flash?.("success", "Fee structure archived and removed from active records.");
    } catch (err) {
      req.flash?.("error", err?.message || "Failed to delete fee structure.");
    }
    return res.redirect("/admin/fee-structures");
  },

  bulk: async (req, res) => {
    try {
      const { FeeStructure } = req.models;
      const ids = String(req.body.ids || "").split(",").map((x) => x.trim()).filter(isValidId);
      const action = str(req.body.action, 20);
      if (!ids.length) throw new Error("Select at least one fee structure.");
      const now = new Date();
      const common = { updatedBy: actorId(req) };
      let update;
      if (action === "activate") update = { ...common, status: "Active", archivedAt: null, archivedBy: null };
      else if (action === "inactive") update = { ...common, status: "Inactive", archivedAt: null, archivedBy: null };
      else if (action === "archive") update = { ...common, status: "Archived", archivedAt: now, archivedBy: actorId(req) };
      else if (action === "delete") update = { ...common, status: "Archived", isDeleted: true, deletedAt: now, deletedBy: actorId(req), archivedAt: now, archivedBy: actorId(req) };
      else throw new Error("Invalid bulk action.");
      const result = await FeeStructure.updateMany({ _id: { $in: ids }, isDeleted: { $ne: true } }, { $set: update });
      req.flash?.("success", `${result.modifiedCount || 0} fee structure(s) updated.`);
    } catch (err) {
      req.flash?.("error", err?.message || "Bulk action failed.");
    }
    return res.redirect("/admin/fee-structures");
  },

  exportCsv: async (req, res) => {
    const { FeeStructure } = req.models;
    const { mongo } = buildFilter(req.query);
    const docs = await FeeStructure.find(mongo)
      .populate("programId", "title shortTitle name code")
      .populate("classId", "name code")
      .populate("intakeId", "name code")
      .sort({ updatedAt: -1 }).lean();
    const rows = [["Code", "Name", "Program", "Class", "Intake", "Academic Year", "Term", "Status", "Items", "Required Items", "Total Amount", "Notes", "Updated At"]];
    docs.map(serialize).forEach((x) => rows.push([x.code, x.name, x.programName, x.className, x.intakeName, x.academicYear, x.term, x.status, x.itemsCount, x.requiredItemsCount, x.totalAmount, x.notes, x.updatedAt]));
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="fee-structures-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(`\uFEFF${csv}`);
  },
};
