const test = require("node:test");
const assert = require("node:assert/strict");
const { migrateExpenses } = require("../scripts/lib/migrateExpenses");

test("expense migration repairs duplicate/missing numbers and backfills lifecycle timestamps", async () => {
  const createdAt = new Date("2026-08-01T00:00:00Z");
  const rows = [
    {
      _id: "1", expenseNumber: "EXP-OLD", category: "Invalid", method: "Wire", status: "Approved",
      title: "First", voucherNo: "", reference: "", description: "", paidTo: "", notes: "",
      approvedAt: null, rejectedAt: null, createdAt, updatedAt: createdAt,
    },
    {
      _id: "2", expenseNumber: "EXP-OLD", category: "Rent", method: "Cash", status: "Rejected",
      title: "Second", voucherNo: "", reference: "", description: "", paidTo: "", notes: "",
      approvedAt: null, rejectedAt: null, createdAt, updatedAt: createdAt,
    },
    {
      _id: "3", expenseNumber: "", category: "Other", method: "Cash", status: "weird",
      title: "Third", voucherNo: "", reference: "", description: "", paidTo: "", notes: "",
      approvedAt: null, rejectedAt: null, createdAt, updatedAt: createdAt,
    },
  ];
  const updates = [];
  const Expense = {
    find() { return { sort: async () => rows }; },
    async exists(query) { return query.expenseNumber === "EXP-OLD" ? { _id: "1" } : null; },
    async updateOne(query, update) { updates.push({ query, update }); return { modifiedCount: 1 }; },
  };

  const result = await migrateExpenses({ Expense });
  assert.equal(result.scanned, 3);
  assert.equal(result.repairedNumbers, 2);
  assert.equal(result.lifecycleBackfilled, 2);
  assert.ok(updates.some((x) => x.query._id === "1" && x.update.$set.category === "Other" && x.update.$set.method === "Other" && x.update.$set.approvedAt));
  assert.ok(updates.some((x) => x.query._id === "2" && /^EXP-20260801-/.test(x.update.$set.expenseNumber) && x.update.$set.rejectedAt));
  assert.ok(updates.some((x) => x.query._id === "3" && /^EXP-20260801-/.test(x.update.$set.expenseNumber) && x.update.$set.status === "Recorded"));
});
