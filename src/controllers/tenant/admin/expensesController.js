const mongoose = require("mongoose");

const actorUserId = (req) =>
  req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;

const str = (v) => String(v ?? "").trim();
const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));

const asNum = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const asDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function makeExpenseNo() {
  return `EXP-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
}

function serializeExpense(doc) {
  return {
    id: String(doc._id),
    expenseNo: doc.expenseNumber || "—",
    voucherNo: doc.voucherNo || "",
    reference: doc.reference || "",
    title: doc.title || "",
    description: doc.description || "",
    category: doc.category || "Other",
    amount: Number(doc.amount || 0),
    expenseDate: doc.expenseDate ? new Date(doc.expenseDate).toISOString().slice(0, 10) : "",
    paidTo: doc.paidTo || "",
    method: doc.method || "Cash",
    status: doc.status || "Recorded",
    notes: doc.notes || "",
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString().slice(0, 10) : "",
  };
}

function computeKpis(list = []) {
  const total = list.length;
  const recorded = list.filter((x) => x.status === "Recorded").length;
  const approved = list.filter((x) => x.status === "Approved").length;
  const rejected = list.filter((x) => x.status === "Rejected").length;
  const draft = list.filter((x) => x.status === "Draft").length;

  const amountTotal = list
    .filter((x) => x.status !== "Rejected")
    .reduce((sum, x) => sum + Number(x.amount || 0), 0);

  const byCategory = Object.entries(
    list.reduce((acc, x) => {
      const key = x.category || "Other";
      acc[key] = (acc[key] || 0) + Number(x.amount || 0);
      return acc;
    }, {})
  )
    .map(([label, amount]) => ({ label, amount }))
    .sort((a, b) => b.amount - a.amount);

  return {
    total,
    recorded,
    approved,
    rejected,
    draft,
    amountTotal,
    byCategory,
  };
}

function buildFilters(query = {}) {
  const q = str(query.q);
  const status = str(query.status || "all");
  const category = str(query.category || "all");
  const method = str(query.method || "all");
  const view = str(query.view || "list") || "list";

  const mongo = { isDeleted: { $ne: true } };

  if (status !== "all") mongo.status = status;
  if (category !== "all") mongo.category = category;
  if (method !== "all") mongo.method = method;

  if (q) {
    mongo.$or = [
      { expenseNumber: new RegExp(q, "i") },
      { voucherNo: new RegExp(q, "i") },
      { reference: new RegExp(q, "i") },
      { title: new RegExp(q, "i") },
      { description: new RegExp(q, "i") },
      { category: new RegExp(q, "i") },
      { paidTo: new RegExp(q, "i") },
      { method: new RegExp(q, "i") },
      { status: new RegExp(q, "i") },
      { notes: new RegExp(q, "i") },
    ];
  }

  return {
    mongo,
    clean: { q, status, category, method, view },
  };
}

module.exports = {
  /**
   * GET /admin/expenses
   */
  index: async (req, res) => {
    const { Expense } = req.models;

    const { mongo, clean } = buildFilters(req.query);

    const expenseDocs = await Expense.find(mongo)
      .sort({ expenseDate: -1, createdAt: -1 })
      .lean();

    const expenses = expenseDocs.map(serializeExpense);
    const kpis = computeKpis(expenses);

    return res.render("tenant/admin/finance/expenses", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      expenses,
      kpis,
      query: clean,
      categories: [
        "Salary",
        "Utilities",
        "Rent",
        "Stationery",
        "Transport",
        "Maintenance",
        "Procurement",
        "Allowance",
        "Other",
      ],
      methods: ["Cash", "Bank", "Mobile Money", "Card", "Cheque", "Transfer", "Other"],
    });
  },

  /**
   * POST /admin/expenses
   */
  create: async (req, res) => {
    const { Expense } = req.models;

    const voucherNo = str(req.body.voucherNo);
    const reference = str(req.body.reference);
    const title = str(req.body.title);
    const description = str(req.body.description);
    const category = str(req.body.category || "Other");
    const amount = Math.max(0, asNum(req.body.amount, 0));
    const expenseDate = asDate(req.body.expenseDate) || new Date();
    const paidTo = str(req.body.paidTo);
    const method = str(req.body.method || "Cash");
    const status = str(req.body.status || "Recorded");
    const notes = str(req.body.notes);

    if (!title) {
      req.flash?.("error", "Expense title is required.");
      return res.redirect("/admin/expenses");
    }

    if (!(amount > 0)) {
      req.flash?.("error", "Expense amount must be greater than zero.");
      return res.redirect("/admin/expenses");
    }

    await Expense.create({
      expenseNumber: makeExpenseNo(),
      voucherNo,
      reference,
      title,
      description,
      category,
      amount,
      expenseDate,
      paidTo,
      method,
      status: ["Draft", "Recorded", "Approved", "Rejected"].includes(status) ? status : "Recorded",
      notes,
      createdBy: actorUserId(req),
      updatedBy: actorUserId(req),
    });

    req.flash?.("success", "Expense recorded successfully.");
    return res.redirect("/admin/expenses");
  },

  /**
   * POST /admin/expenses/:id/update
   */
  update: async (req, res) => {
    const { Expense } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid expense ID.");
      return res.redirect("/admin/expenses");
    }

    const existing = await Expense.findOne({
      _id: req.params.id,
      isDeleted: { $ne: true },
    });

    if (!existing) {
      req.flash?.("error", "Expense not found.");
      return res.redirect("/admin/expenses");
    }

    const voucherNo = str(req.body.voucherNo);
    const reference = str(req.body.reference);
    const title = str(req.body.title);
    const description = str(req.body.description);
    const category = str(req.body.category || "Other");
    const amount = Math.max(0, asNum(req.body.amount, 0));
    const expenseDate = asDate(req.body.expenseDate) || existing.expenseDate || new Date();
    const paidTo = str(req.body.paidTo);
    const method = str(req.body.method || "Cash");
    const status = str(req.body.status || existing.status || "Recorded");
    const notes = str(req.body.notes);

    if (!title) {
      req.flash?.("error", "Expense title is required.");
      return res.redirect("/admin/expenses");
    }

    if (!(amount > 0)) {
      req.flash?.("error", "Expense amount must be greater than zero.");
      return res.redirect("/admin/expenses");
    }

    existing.voucherNo = voucherNo;
    existing.reference = reference;
    existing.title = title;
    existing.description = description;
    existing.category = category;
    existing.amount = amount;
    existing.expenseDate = expenseDate;
    existing.paidTo = paidTo;
    existing.method = method;
    existing.status = ["Draft", "Recorded", "Approved", "Rejected"].includes(status) ? status : existing.status;
    existing.notes = notes;
    existing.updatedBy = actorUserId(req);

    await existing.save();

    req.flash?.("success", "Expense updated successfully.");
    return res.redirect("/admin/expenses");
  },

  /**
   * POST /admin/expenses/:id/record
   */
  record: async (req, res) => {
    const { Expense } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid expense ID.");
      return res.redirect("/admin/expenses");
    }

    await Expense.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "Recorded", updatedBy: actorUserId(req) } }
    );

    req.flash?.("success", "Expense marked as recorded.");
    return res.redirect("/admin/expenses");
  },

  /**
   * POST /admin/expenses/:id/approve
   */
  approve: async (req, res) => {
    const { Expense } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid expense ID.");
      return res.redirect("/admin/expenses");
    }

    await Expense.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "Approved", updatedBy: actorUserId(req) } }
    );

    req.flash?.("success", "Expense approved.");
    return res.redirect("/admin/expenses");
  },

  /**
   * POST /admin/expenses/:id/reject
   */
  reject: async (req, res) => {
    const { Expense } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid expense ID.");
      return res.redirect("/admin/expenses");
    }

    await Expense.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "Rejected", updatedBy: actorUserId(req) } }
    );

    req.flash?.("success", "Expense rejected.");
    return res.redirect("/admin/expenses");
  },

  /**
   * POST /admin/expenses/:id/delete
   */
  delete: async (req, res) => {
    const { Expense } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid expense ID.");
      return res.redirect("/admin/expenses");
    }

    await Expense.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          updatedBy: actorUserId(req),
        },
      }
    );

    req.flash?.("success", "Expense deleted.");
    return res.redirect("/admin/expenses");
  },

  /**
   * POST /admin/expenses/bulk
   */
  bulkAction: async (req, res) => {
    const { Expense } = req.models;

    const ids = str(req.body.ids)
      .split(",")
      .map((x) => x.trim())
      .filter((x) => isValidId(x));

    if (!ids.length) {
      req.flash?.("error", "No expenses selected.");
      return res.redirect("/admin/expenses");
    }

    const action = str(req.body.action);
    const patch = { updatedBy: actorUserId(req) };

    if (action === "record") patch.status = "Recorded";
    if (action === "approve") patch.status = "Approved";
    if (action === "reject") patch.status = "Rejected";
    if (action === "draft") patch.status = "Draft";
    if (action === "delete") {
      patch.isDeleted = true;
      patch.deletedAt = new Date();
    }

    await Expense.updateMany(
      { _id: { $in: ids }, isDeleted: { $ne: true } },
      { $set: patch }
    );

    req.flash?.("success", "Bulk action applied.");
    return res.redirect("/admin/expenses");
  },
};