const crypto = require("crypto");

const CATEGORIES = [
  "Salary",
  "Utilities",
  "Rent",
  "Stationery",
  "Transport",
  "Maintenance",
  "Procurement",
  "Allowance",
  "Other",
];
const METHODS = ["Cash", "Bank", "Mobile Money", "Card", "Cheque", "Transfer", "Other"];
const STATUSES = ["Draft", "Recorded", "Approved", "Rejected"];

function str(value, max = 5000) {
  return String(value ?? "").trim().slice(0, max);
}

function escapeRegex(value) {
  return str(value, 200).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function asDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeCategory(value) {
  const v = str(value, 80);
  return CATEGORIES.includes(v) ? v : "Other";
}

function normalizeMethod(value) {
  const v = str(value, 80);
  return METHODS.includes(v) ? v : "Other";
}

function normalizeInitialStatus(value) {
  return str(value) === "Draft" ? "Draft" : "Recorded";
}

function normalizeEditableStatus(value, existingStatus = "Recorded") {
  const requested = str(value);
  if (["Draft", "Recorded"].includes(requested)) return requested;
  if (existingStatus === "Rejected" && requested === "Rejected") return "Rejected";
  return existingStatus === "Approved" ? "Approved" : "Recorded";
}

function validateExpensePayload(body = {}, { existingStatus = null, create = false } = {}) {
  const amount = asNumber(body.amount);
  const expenseDate = asDate(body.expenseDate) || new Date();
  const value = {
    voucherNo: str(body.voucherNo, 120),
    reference: str(body.reference, 180),
    title: str(body.title, 220),
    description: str(body.description, 3000),
    category: normalizeCategory(body.category),
    amount,
    expenseDate,
    paidTo: str(body.paidTo, 220),
    method: normalizeMethod(body.method),
    status: create
      ? normalizeInitialStatus(body.status)
      : normalizeEditableStatus(body.status, existingStatus || "Recorded"),
    notes: str(body.notes, 3000),
  };
  const errors = [];
  if (!value.title) errors.push("Expense title is required.");
  if (!Number.isFinite(amount) || amount <= 0) errors.push("Expense amount must be greater than zero.");
  if (Number.isFinite(amount) && amount > 1_000_000_000_000_000) errors.push("Expense amount is too large.");
  return { value, errors };
}

function dateStamp(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid expense number date.");
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function makeExpenseNumber(now = new Date()) {
  const suffix = crypto.randomBytes(5).toString("hex").toUpperCase();
  return `EXP-${dateStamp(now)}-${suffix}`;
}

async function generateExpenseNumber(Expense, now = new Date(), attempts = 8) {
  if (!Expense) throw new Error("Expense model is unavailable.");
  for (let i = 0; i < attempts; i += 1) {
    const expenseNumber = makeExpenseNumber(now);
    const exists = await Expense.exists({ expenseNumber });
    if (!exists) return expenseNumber;
  }
  throw new Error("Could not allocate a unique expense number.");
}

function buildExpenseFilters(query = {}) {
  const q = str(query.q, 200);
  const status = STATUSES.includes(str(query.status)) ? str(query.status) : "all";
  const category = CATEGORIES.includes(str(query.category)) ? str(query.category) : "all";
  const method = METHODS.includes(str(query.method)) ? str(query.method) : "all";
  const view = ["list", "categories", "summary"].includes(str(query.view)) ? str(query.view) : "list";
  const mongo = { isDeleted: { $ne: true } };

  if (status !== "all") mongo.status = status;
  if (category !== "all") mongo.category = category;
  if (method !== "all") mongo.method = method;
  if (q) {
    const re = new RegExp(escapeRegex(q), "i");
    mongo.$or = [
      { expenseNumber: re },
      { voucherNo: re },
      { reference: re },
      { title: re },
      { description: re },
      { category: re },
      { paidTo: re },
      { method: re },
      { status: re },
      { notes: re },
    ];
  }
  return { mongo, clean: { q, status, category, method, view } };
}

function csvCell(value) {
  let text = String(value ?? "").replace(/\r?\n/g, " ");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function serializeExpense(doc = {}) {
  return {
    id: String(doc._id || ""),
    expenseNo: doc.expenseNumber || "—",
    voucherNo: doc.voucherNo || "",
    reference: doc.reference || "",
    title: doc.title || "",
    description: doc.description || "",
    category: normalizeCategory(doc.category),
    amount: Number(doc.amount || 0),
    expenseDate: doc.expenseDate ? new Date(doc.expenseDate).toISOString().slice(0, 10) : "",
    paidTo: doc.paidTo || "",
    method: METHODS.includes(doc.method) ? doc.method : "Other",
    status: STATUSES.includes(doc.status) ? doc.status : "Recorded",
    notes: doc.notes || "",
    approvedAt: doc.approvedAt ? new Date(doc.approvedAt).toISOString() : "",
    rejectedAt: doc.rejectedAt ? new Date(doc.rejectedAt).toISOString() : "",
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString().slice(0, 10) : "",
  };
}

function computeExpenseKpis(list = []) {
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
      const key = normalizeCategory(x.category);
      acc[key] = (acc[key] || 0) + Number(x.amount || 0);
      return acc;
    }, {})
  )
    .map(([label, amount]) => ({ label, amount }))
    .sort((a, b) => b.amount - a.amount);
  return { total, recorded, approved, rejected, draft, amountTotal, byCategory };
}

const TRANSITIONS = {
  record: { from: ["Draft", "Rejected"], to: "Recorded" },
  approve: { from: ["Recorded"], to: "Approved" },
  reject: { from: ["Recorded"], to: "Rejected" },
  draft: { from: ["Recorded", "Rejected"], to: "Draft" },
};

function transitionSpec(action) {
  return TRANSITIONS[str(action)] || null;
}

module.exports = {
  CATEGORIES,
  METHODS,
  STATUSES,
  buildExpenseFilters,
  computeExpenseKpis,
  csvCell,
  escapeRegex,
  generateExpenseNumber,
  makeExpenseNumber,
  normalizeCategory,
  normalizeMethod,
  serializeExpense,
  transitionSpec,
  validateExpensePayload,
};
