const mongoose = require("mongoose");

const actorUserId = (req) =>
  req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;

const str = (v) => String(v ?? "").trim();
const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));

const asNum = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function getProgramName(p) {
  if (!p) return "—";
  return p.name || p.title || p.programName || p.code || "—";
}

function getClassName(c) {
  if (!c) return "—";
  return c.name || c.title || c.className || c.code || "—";
}

function getIntakeName(i) {
  if (!i) return "—";
  return i.name || i.title || i.label || i.code || "—";
}

function parseItemsFromBody(body = {}) {
  const titles = Array.isArray(body.itemTitle) ? body.itemTitle : [body.itemTitle];
  const categories = Array.isArray(body.itemCategory) ? body.itemCategory : [body.itemCategory];
  const amounts = Array.isArray(body.itemAmount) ? body.itemAmount : [body.itemAmount];
  const requireds = Array.isArray(body.itemRequired) ? body.itemRequired : [body.itemRequired];
  const notes = Array.isArray(body.itemNote) ? body.itemNote : [body.itemNote];

  const maxLen = Math.max(
    titles.length,
    categories.length,
    amounts.length,
    requireds.length,
    notes.length
  );

  const items = [];

  for (let i = 0; i < maxLen; i += 1) {
    const title = str(titles[i]);
    const category = str(categories[i] || "Tuition");
    const amount = Math.max(0, asNum(amounts[i], 0));
    const required = ["1", "true", "yes", "on"].includes(String(requireds[i] || "").toLowerCase());
    const note = str(notes[i]);

    if (!title) continue;

    items.push({
      title,
      category,
      amount,
      required,
      note,
    });
  }

  return items;
}

function serializeFeeStructure(doc) {
  const program = doc.programId || null;
  const classObj = doc.classId || null;
  const intake = doc.intakeId || null;

  return {
    id: String(doc._id),
    name: doc.name || "",
    programId: program?._id ? String(program._id) : String(doc.programId?._id || doc.programId || ""),
    programName: getProgramName(program),
    classId: classObj?._id ? String(classObj._id) : String(doc.classId?._id || doc.classId || ""),
    className: getClassName(classObj),
    intakeId: intake?._id ? String(intake._id) : String(doc.intakeId?._id || doc.intakeId || ""),
    intakeName: getIntakeName(intake),
    academicYear: doc.academicYear || "",
    term: doc.term || "",
    totalAmount: Number(doc.totalAmount || 0),
    status: doc.status || "Active",
    notes: doc.notes || "",
    items: Array.isArray(doc.items)
      ? doc.items.map((item, index) => ({
          rowId: String(index + 1),
          title: item.title || "",
          category: item.category || "Tuition",
          amount: Number(item.amount || 0),
          required: !!item.required,
          note: item.note || "",
        }))
      : [],
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString().slice(0, 10) : "",
  };
}

function computeKpis(list = []) {
  const active = list.filter((x) => x.status === "Active").length;
  const inactive = list.filter((x) => x.status === "Inactive").length;
  const archived = list.filter((x) => x.status === "Archived").length;
  const totalAmount = list.reduce((sum, x) => sum + Number(x.totalAmount || 0), 0);
  const items = list.reduce((sum, x) => sum + Number((x.items || []).length), 0);

  return {
    total: list.length,
    active,
    inactive,
    archived,
    totalAmount,
    items,
  };
}

function buildFilters(query = {}) {
  const q = str(query.q);
  const status = str(query.status || "all");
  const program = str(query.program || "all");
  const academicYear = str(query.academicYear || "all");
  const view = str(query.view || "list") || "list";

  const mongo = { isDeleted: { $ne: true } };

  if (status !== "all") mongo.status = status;
  if (program !== "all" && isValidId(program)) mongo.programId = program;
  if (academicYear !== "all") mongo.academicYear = academicYear;

  if (q) {
    mongo.$or = [
      { name: new RegExp(q, "i") },
      { academicYear: new RegExp(q, "i") },
      { term: new RegExp(q, "i") },
      { status: new RegExp(q, "i") },
      { notes: new RegExp(q, "i") },
    ];
  }

  return {
    mongo,
    clean: { q, status, program, academicYear, view },
  };
}

module.exports = {
  /**
   * GET /admin/fee-structures
   */
  index: async (req, res) => {
    const { FeeStructure, Program, Class, Intake } = req.models;

    const { mongo, clean } = buildFilters(req.query);

    const [feeDocs, programDocs, classDocs, intakeDocs] = await Promise.all([
      FeeStructure.find(mongo)
        .populate("programId", "name title code")
        .populate("classId", "name title code")
        .populate("intakeId", "name title code label")
        .sort({ createdAt: -1 })
        .lean(),
      Program
        ? Program.find({}).select("name title code").sort({ name: 1, title: 1 }).lean()
        : [],
      Class
        ? Class.find({}).select("name title code className").sort({ name: 1, title: 1 }).lean()
        : [],
      Intake
        ? Intake.find({}).select("name title code label").sort({ createdAt: -1 }).lean()
        : [],
    ]);

    const feeStructures = feeDocs.map(serializeFeeStructure);
    const kpis = computeKpis(feeStructures);

    const yearSet = new Set(
      feeStructures
        .map((x) => str(x.academicYear))
        .filter(Boolean)
    );

    return res.render("tenant/admin/finance/fee-structures", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      feeStructures,
      kpis,
      programs: (programDocs || []).map((p) => ({
        id: String(p._id),
        name: getProgramName(p),
      })),
      classes: (classDocs || []).map((c) => ({
        id: String(c._id),
        name: getClassName(c),
      })),
      intakes: (intakeDocs || []).map((i) => ({
        id: String(i._id),
        name: getIntakeName(i),
      })),
      years: Array.from(yearSet).sort(),
      query: clean,
    });
  },

  /**
   * POST /admin/fee-structures
   */
  create: async (req, res) => {
    const { FeeStructure } = req.models;

    const name = str(req.body.name);
    const programId = str(req.body.programId);
    const classId = str(req.body.classId);
    const intakeId = str(req.body.intakeId);
    const academicYear = str(req.body.academicYear);
    const term = str(req.body.term);
    const status = str(req.body.status || "Active");
    const notes = str(req.body.notes);

    if (!name) {
      req.flash?.("error", "Fee structure name is required.");
      return res.redirect("/admin/fee-structures");
    }

    const items = parseItemsFromBody(req.body);
    if (!items.length) {
      req.flash?.("error", "Add at least one fee item.");
      return res.redirect("/admin/fee-structures");
    }

    const totalAmount = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);

    await FeeStructure.create({
      name,
      programId: isValidId(programId) ? programId : null,
      classId: isValidId(classId) ? classId : null,
      intakeId: isValidId(intakeId) ? intakeId : null,
      academicYear,
      term,
      items,
      totalAmount,
      status: ["Active", "Inactive", "Archived"].includes(status) ? status : "Active",
      notes,
      createdBy: actorUserId(req),
      updatedBy: actorUserId(req),
    });

    req.flash?.("success", "Fee structure created successfully.");
    return res.redirect("/admin/fee-structures");
  },

  /**
   * POST /admin/fee-structures/:id/update
   */
  update: async (req, res) => {
    const { FeeStructure } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid fee structure ID.");
      return res.redirect("/admin/fee-structures");
    }

    const existing = await FeeStructure.findOne({
      _id: req.params.id,
      isDeleted: { $ne: true },
    });

    if (!existing) {
      req.flash?.("error", "Fee structure not found.");
      return res.redirect("/admin/fee-structures");
    }

    const name = str(req.body.name);
    const programId = str(req.body.programId);
    const classId = str(req.body.classId);
    const intakeId = str(req.body.intakeId);
    const academicYear = str(req.body.academicYear);
    const term = str(req.body.term);
    const status = str(req.body.status || existing.status || "Active");
    const notes = str(req.body.notes);

    if (!name) {
      req.flash?.("error", "Fee structure name is required.");
      return res.redirect("/admin/fee-structures");
    }

    const items = parseItemsFromBody(req.body);
    if (!items.length) {
      req.flash?.("error", "Add at least one fee item.");
      return res.redirect("/admin/fee-structures");
    }

    existing.name = name;
    existing.programId = isValidId(programId) ? programId : null;
    existing.classId = isValidId(classId) ? classId : null;
    existing.intakeId = isValidId(intakeId) ? intakeId : null;
    existing.academicYear = academicYear;
    existing.term = term;
    existing.items = items;
    existing.totalAmount = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    existing.status = ["Active", "Inactive", "Archived"].includes(status) ? status : existing.status;
    existing.notes = notes;
    existing.updatedBy = actorUserId(req);

    await existing.save();

    req.flash?.("success", "Fee structure updated successfully.");
    return res.redirect("/admin/fee-structures");
  },

  /**
   * POST /admin/fee-structures/:id/activate
   */
  activate: async (req, res) => {
    const { FeeStructure } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid fee structure ID.");
      return res.redirect("/admin/fee-structures");
    }

    await FeeStructure.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      {
        $set: {
          status: "Active",
          updatedBy: actorUserId(req),
        },
      }
    );

    req.flash?.("success", "Fee structure activated.");
    return res.redirect("/admin/fee-structures");
  },

  /**
   * POST /admin/fee-structures/:id/archive
   */
  archive: async (req, res) => {
    const { FeeStructure } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid fee structure ID.");
      return res.redirect("/admin/fee-structures");
    }

    await FeeStructure.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      {
        $set: {
          status: "Archived",
          updatedBy: actorUserId(req),
        },
      }
    );

    req.flash?.("success", "Fee structure archived.");
    return res.redirect("/admin/fee-structures");
  },

  /**
   * POST /admin/fee-structures/:id/delete
   */
  delete: async (req, res) => {
    const { FeeStructure } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid fee structure ID.");
      return res.redirect("/admin/fee-structures");
    }

    await FeeStructure.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          updatedBy: actorUserId(req),
        },
      }
    );

    req.flash?.("success", "Fee structure deleted.");
    return res.redirect("/admin/fee-structures");
  },

  /**
   * POST /admin/fee-structures/bulk
   */
  bulkAction: async (req, res) => {
    const { FeeStructure } = req.models;

    const ids = str(req.body.ids)
      .split(",")
      .map((x) => x.trim())
      .filter((x) => isValidId(x));

    if (!ids.length) {
      req.flash?.("error", "No fee structures selected.");
      return res.redirect("/admin/fee-structures");
    }

    const action = str(req.body.action);
    const patch = { updatedBy: actorUserId(req) };

    if (action === "activate") patch.status = "Active";
    if (action === "inactive") patch.status = "Inactive";
    if (action === "archive") patch.status = "Archived";
    if (action === "delete") {
      patch.isDeleted = true;
      patch.deletedAt = new Date();
    }

    await FeeStructure.updateMany(
      { _id: { $in: ids }, isDeleted: { $ne: true } },
      { $set: patch }
    );

    req.flash?.("success", "Bulk action applied.");
    return res.redirect("/admin/fee-structures");
  },
};