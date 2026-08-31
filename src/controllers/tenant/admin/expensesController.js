const mongoose = require("mongoose");
const {
  CATEGORIES,
  METHODS,
  buildExpenseFilters,
  computeExpenseKpis,
  csvCell,
  generateExpenseNumber,
  serializeExpense,
  transitionSpec,
  validateExpensePayload,
} = require("../../../services/tenant/expenseService");

const actorUserId = (req) =>
  req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;
const str = (v) => String(v ?? "").trim();
const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));

function transitionPatch(action, actor, now = new Date()) {
  const spec = transitionSpec(action);
  if (!spec) return null;
  const patch = { status: spec.to, updatedBy: actor };
  if (action === "approve") {
    patch.approvedAt = now;
    patch.approvedBy = actor;
    patch.rejectedAt = null;
    patch.rejectedBy = null;
  } else if (action === "reject") {
    patch.rejectedAt = now;
    patch.rejectedBy = actor;
    patch.approvedAt = null;
    patch.approvedBy = null;
  } else {
    patch.approvedAt = null;
    patch.approvedBy = null;
    if (action === "record") {
      patch.rejectedAt = null;
      patch.rejectedBy = null;
    }
  }
  return patch;
}

async function transitionOne(req, res, action, successMessage) {
  const { Expense } = req.models;
  if (!isValidId(req.params.id)) {
    req.flash?.("error", "Invalid expense ID.");
    return res.redirect("/admin/expenses");
  }

  const spec = transitionSpec(action);
  if (!spec) {
    req.flash?.("error", "Invalid expense action.");
    return res.redirect("/admin/expenses");
  }

  const result = await Expense.updateOne(
    {
      _id: req.params.id,
      isDeleted: { $ne: true },
      status: { $in: spec.from },
    },
    { $set: transitionPatch(action, actorUserId(req)) },
    { runValidators: true }
  );

  if (!result.modifiedCount) {
    const current = await Expense.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
      .select("status")
      .lean();
    req.flash?.(
      "error",
      current
        ? `Expense cannot move from ${current.status} to ${spec.to}.`
        : "Expense not found."
    );
    return res.redirect("/admin/expenses");
  }

  req.flash?.("success", successMessage);
  return res.redirect("/admin/expenses");
}

async function createWithUniqueNumber(Expense, payload, attempts = 8) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    const expenseNumber = await generateExpenseNumber(Expense);
    try {
      return await Expense.create({ ...payload, expenseNumber });
    } catch (err) {
      lastError = err;
      if (err?.code !== 11000) throw err;
    }
  }
  throw lastError || new Error("Could not allocate a unique expense number.");
}

module.exports = {
  index: async (req, res) => {
    const { Expense } = req.models;
    const { mongo, clean } = buildExpenseFilters(req.query);
    const expenseDocs = await Expense.find(mongo).sort({ expenseDate: -1, createdAt: -1 }).lean();
    const expenses = expenseDocs.map(serializeExpense);

    return res.render("tenant/finance/expenses", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      expenses,
      kpis: computeExpenseKpis(expenses),
      query: clean,
      categories: CATEGORIES,
      methods: METHODS,
    });
  },

  exportCsv: async (req, res) => {
    const { Expense } = req.models;
    const { mongo } = buildExpenseFilters(req.query);
    const filename = `expenses-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.write(
      [
        "Expense No",
        "Voucher No",
        "Reference",
        "Title",
        "Category",
        "Amount",
        "Expense Date",
        "Paid To",
        "Method",
        "Status",
        "Description",
        "Notes",
      ].map(csvCell).join(",") + "\n"
    );

    const cursor = Expense.find(mongo).sort({ expenseDate: -1, createdAt: -1 }).lean().cursor();
    for await (const doc of cursor) {
      const row = serializeExpense(doc);
      res.write(
        [
          row.expenseNo,
          row.voucherNo,
          row.reference,
          row.title,
          row.category,
          row.amount,
          row.expenseDate,
          row.paidTo,
          row.method,
          row.status,
          row.description,
          row.notes,
        ].map(csvCell).join(",") + "\n"
      );
    }
    return res.end();
  },

  create: async (req, res) => {
    const { Expense } = req.models;
    const checked = validateExpensePayload(req.body || {}, { create: true });
    if (checked.errors.length) {
      req.flash?.("error", checked.errors.join(" "));
      return res.redirect("/admin/expenses");
    }

    await createWithUniqueNumber(Expense, {
      ...checked.value,
      createdBy: actorUserId(req),
      updatedBy: actorUserId(req),
    });

    req.flash?.("success", "Expense recorded successfully.");
    return res.redirect("/admin/expenses");
  },

  update: async (req, res) => {
    const { Expense } = req.models;
    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid expense ID.");
      return res.redirect("/admin/expenses");
    }

    const existing = await Expense.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!existing) {
      req.flash?.("error", "Expense not found.");
      return res.redirect("/admin/expenses");
    }
    if (existing.status === "Approved") {
      req.flash?.("error", "Approved expenses are locked. Create a correction/reversal record instead of editing the approved record.");
      return res.redirect("/admin/expenses");
    }

    const checked = validateExpensePayload(req.body || {}, { existingStatus: existing.status });
    if (checked.errors.length) {
      req.flash?.("error", checked.errors.join(" "));
      return res.redirect("/admin/expenses");
    }

    Object.assign(existing, checked.value, { updatedBy: actorUserId(req) });
    if (checked.value.status !== "Rejected") {
      existing.rejectedAt = null;
      existing.rejectedBy = null;
    }
    existing.approvedAt = null;
    existing.approvedBy = null;
    await existing.save();

    req.flash?.("success", "Expense updated successfully.");
    return res.redirect("/admin/expenses");
  },

  record: async (req, res) => transitionOne(req, res, "record", "Expense marked as recorded."),
  approve: async (req, res) => transitionOne(req, res, "approve", "Expense approved."),
  reject: async (req, res) => transitionOne(req, res, "reject", "Expense rejected."),

  delete: async (req, res) => {
    const { Expense } = req.models;
    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid expense ID.");
      return res.redirect("/admin/expenses");
    }

    const result = await Expense.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true }, status: { $ne: "Approved" } },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          updatedBy: actorUserId(req),
        },
      }
    );
    if (!result.modifiedCount) {
      const current = await Expense.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).select("status").lean();
      req.flash?.(
        "error",
        current?.status === "Approved"
          ? "Approved expenses are locked and cannot be deleted."
          : "Expense not found."
      );
      return res.redirect("/admin/expenses");
    }

    req.flash?.("success", "Expense deleted.");
    return res.redirect("/admin/expenses");
  },

  bulkAction: async (req, res) => {
    const { Expense } = req.models;
    const ids = [...new Set(
      str(req.body.ids)
        .split(",")
        .map((x) => x.trim())
        .filter((x) => isValidId(x))
    )];
    if (!ids.length) {
      req.flash?.("error", "No expenses selected.");
      return res.redirect("/admin/expenses");
    }

    const action = str(req.body.action);
    let filter = { _id: { $in: ids }, isDeleted: { $ne: true } };
    let patch = null;

    if (action === "delete") {
      filter.status = { $ne: "Approved" };
      patch = { isDeleted: true, deletedAt: new Date(), updatedBy: actorUserId(req) };
    } else {
      const spec = transitionSpec(action);
      if (!spec) {
        req.flash?.("error", "Invalid bulk expense action.");
        return res.redirect("/admin/expenses");
      }
      filter.status = { $in: spec.from };
      patch = transitionPatch(action, actorUserId(req));
    }

    const result = await Expense.updateMany(filter, { $set: patch }, { runValidators: true });
    const skipped = Math.max(0, ids.length - Number(result.modifiedCount || 0));
    if (!result.modifiedCount) {
      req.flash?.("error", "None of the selected expenses were eligible for that action.");
    } else {
      req.flash?.(
        "success",
        `Bulk action applied to ${result.modifiedCount} expense(s).${skipped ? ` ${skipped} selected record(s) were skipped by lifecycle rules.` : ""}`
      );
    }
    return res.redirect("/admin/expenses");
  },
};
