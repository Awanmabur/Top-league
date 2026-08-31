const { subscriptionEffectiveStatus } = require("./platformSubscriptionService");

const CASH_INFLOW_TYPES = new Set(["school_subscription", "student_subscription", "revenue_split", "manual_adjust"]);

function summarizeSubscriptions(rows = [], now = new Date()) {
  const summary = { active: 0, trial: 0, past_due: 0, suspended: 0, cancelled: 0, expired: 0 };
  for (const row of rows) {
    const status = subscriptionEffectiveStatus(row, now);
    if (Object.prototype.hasOwnProperty.call(summary, status)) summary[status] += 1;
  }
  return summary;
}

function paymentRevenueAmount(payment = {}) {
  if (String(payment.status || "").toLowerCase() !== "completed") return 0;
  const amount = Number(payment.amount || 0);
  if (!Number.isFinite(amount)) return 0;
  const type = String(payment.type || "").toLowerCase();
  if (type === "refund") return -Math.abs(amount);
  if (CASH_INFLOW_TYPES.has(type)) return amount;
  return 0;
}

function netRevenue(payments = []) {
  return payments.reduce((sum, payment) => sum + paymentRevenueAmount(payment), 0);
}

function csvCell(value) {
  let text = String(value == null ? "" : value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function csv(rows = []) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

module.exports = {
  CASH_INFLOW_TYPES,
  summarizeSubscriptions,
  paymentRevenueAmount,
  netRevenue,
  csvCell,
  csv,
};
