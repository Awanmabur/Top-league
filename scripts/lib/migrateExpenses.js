const {
  makeExpenseNumber,
  normalizeCategory,
  normalizeMethod,
  STATUSES,
} = require("../../src/services/tenant/expenseService");

function str(value, max = 5000) {
  return String(value ?? "").trim().slice(0, max);
}

async function allocateExpenseNumber(Expense, used, now = new Date()) {
  for (let i = 0; i < 12; i += 1) {
    const candidate = makeExpenseNumber(now);
    if (used.has(candidate)) continue;
    const exists = await Expense.exists({ expenseNumber: candidate });
    if (!exists) {
      used.add(candidate);
      return candidate;
    }
  }
  throw new Error("Could not repair a legacy expense number.");
}

async function migrateExpenses(models = {}) {
  const { Expense } = models;
  if (!Expense) return { scanned: 0, normalized: 0, repairedNumbers: 0, lifecycleBackfilled: 0 };

  const rows = await Expense.find({}).sort({ createdAt: 1, _id: 1 });
  const counts = new Map();
  for (const row of rows) {
    const number = str(row.expenseNumber, 64);
    if (number) counts.set(number, (counts.get(number) || 0) + 1);
  }

  const kept = new Set();
  const used = new Set([...counts.keys()]);
  let normalized = 0;
  let repairedNumbers = 0;
  let lifecycleBackfilled = 0;

  for (const row of rows) {
    const patch = {};
    const currentNo = str(row.expenseNumber, 64);
    const isDuplicate = currentNo && (counts.get(currentNo) || 0) > 1;
    const keepCurrent = currentNo && (!isDuplicate || !kept.has(currentNo));
    if (keepCurrent) kept.add(currentNo);
    else {
      patch.expenseNumber = await allocateExpenseNumber(Expense, used, row.createdAt || new Date());
      repairedNumbers += 1;
    }

    const category = normalizeCategory(row.category);
    const method = normalizeMethod(row.method);
    const status = STATUSES.includes(str(row.status)) ? str(row.status) : "Recorded";
    if (category !== row.category) patch.category = category;
    if (method !== row.method) patch.method = method;
    if (status !== row.status) patch.status = status;

    const voucherNo = str(row.voucherNo, 120);
    const reference = str(row.reference, 180);
    const title = str(row.title || "Legacy expense", 220);
    const description = str(row.description, 3000);
    const paidTo = str(row.paidTo, 220);
    const notes = str(row.notes, 3000);
    if (voucherNo !== String(row.voucherNo || "")) patch.voucherNo = voucherNo;
    if (reference !== String(row.reference || "")) patch.reference = reference;
    if (title !== String(row.title || "")) patch.title = title;
    if (description !== String(row.description || "")) patch.description = description;
    if (paidTo !== String(row.paidTo || "")) patch.paidTo = paidTo;
    if (notes !== String(row.notes || "")) patch.notes = notes;

    const effectiveStatus = patch.status || row.status;
    if (effectiveStatus === "Approved" && !row.approvedAt) {
      patch.approvedAt = row.updatedAt || row.createdAt || new Date();
      lifecycleBackfilled += 1;
    }
    if (effectiveStatus === "Rejected" && !row.rejectedAt) {
      patch.rejectedAt = row.updatedAt || row.createdAt || new Date();
      lifecycleBackfilled += 1;
    }
    if (effectiveStatus !== "Approved" && row.approvedAt) {
      patch.approvedAt = null;
      patch.approvedBy = null;
    }
    if (effectiveStatus !== "Rejected" && row.rejectedAt) {
      patch.rejectedAt = null;
      patch.rejectedBy = null;
    }

    if (Object.keys(patch).length) {
      await Expense.updateOne({ _id: row._id }, { $set: patch });
      normalized += 1;
    }
  }

  return { scanned: rows.length, normalized, repairedNumbers, lifecycleBackfilled };
}

module.exports = { migrateExpenses };
