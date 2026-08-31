function tenantDateKey(date, timezone = "UTC") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDateKey(key, days) {
  const match = String(key || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days || 0)),
  );
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function recentDateKeys(now = new Date(), timezone = "UTC", count = 15) {
  const today = tenantDateKey(now, timezone);
  const safeCount = Math.max(1, Math.min(60, Number(count) || 15));
  return Array.from(
    { length: safeCount },
    (_, index) => shiftDateKey(today, index - safeCount + 1),
  );
}

function fillDailySeries(rows = [], keys = []) {
  const values = new Map(
    (rows || []).map((row) => [String(row?._id || ""), Number(row?.value || 0)]),
  );
  return (keys || []).map((key) => values.get(String(key)) || 0);
}

function calculateStudentFinanceExposure(invoiceGroups = [], paymentGroups = []) {
  const perStudent = new Map();

  for (const row of invoiceGroups || []) {
    const key = String(row?._id || "");
    if (!key) continue;
    perStudent.set(key, {
      outstanding: Math.max(0, Number(row?.outstanding || 0)),
      received: 0,
      applied: 0,
    });
  }

  for (const row of paymentGroups || []) {
    const key = String(row?._id || "");
    if (!key) continue;
    const current = perStudent.get(key) || { outstanding: 0, received: 0, applied: 0 };
    current.received = Math.max(0, Number(row?.received || 0));
    current.applied = Math.max(0, Number(row?.applied || 0));
    perStudent.set(key, current);
  }

  let outstanding = 0;
  let studentsOwing = 0;
  const byStudent = new Map();

  for (const [studentId, row] of perStudent.entries()) {
    const unallocatedCredit = Math.max(0, row.received - row.applied);
    const balance = Math.max(0, row.outstanding - unallocatedCredit);
    const remainingCredit = Math.max(0, unallocatedCredit - row.outstanding);
    outstanding += balance;
    if (balance > 0) studentsOwing += 1;
    byStudent.set(studentId, { balance, credit: remainingCredit });
  }

  return { outstanding, studentsOwing, byStudent };
}

module.exports = {
  tenantDateKey,
  shiftDateKey,
  recentDateKeys,
  fillDailySeries,
  calculateStudentFinanceExposure,
};
