const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildExpenseFilters,
  csvCell,
  generateExpenseNumber,
  makeExpenseNumber,
  transitionSpec,
  validateExpensePayload,
} = require("../src/services/tenant/expenseService");

test("expense search escapes regex metacharacters instead of accepting raw regex input", () => {
  const { mongo } = buildExpenseFilters({ q: "rent.*(x)+" });
  const re = mongo.$or[0].expenseNumber;
  assert.equal(re.test("rent.*(x)+"), true);
  assert.equal(re.test("rentZZx"), false);
});

test("expense numbers use a dated cryptographic suffix and never Math.random", () => {
  const value = makeExpenseNumber(new Date("2026-08-29T12:00:00Z"));
  assert.match(value, /^EXP-20260829-[0-9A-F]{10}$/);
  const source = fs.readFileSync(path.join(__dirname, "../src/services/tenant/expenseService.js"), "utf8");
  assert.doesNotMatch(source, /Math\.random/);
});

test("expense number allocation retries database collisions", async () => {
  let calls = 0;
  const Expense = {
    async exists() {
      calls += 1;
      return calls < 3 ? { _id: calls } : null;
    },
  };
  const number = await generateExpenseNumber(Expense, new Date("2026-08-29T12:00:00Z"), 4);
  assert.match(number, /^EXP-20260829-/);
  assert.equal(calls, 3);
});

test("expense create/update payloads cannot jump directly into Approved or Rejected lifecycle states", () => {
  const created = validateExpensePayload(
    { title: "Rent", amount: "100", status: "Approved", category: "Rent", method: "Bank" },
    { create: true }
  );
  assert.equal(created.errors.length, 0);
  assert.equal(created.value.status, "Recorded");

  const updated = validateExpensePayload(
    { title: "Rent", amount: "100", status: "Approved", category: "Rent", method: "Bank" },
    { existingStatus: "Recorded" }
  );
  assert.equal(updated.value.status, "Recorded");
});

test("expense lifecycle only allows controlled transitions and keeps Approved terminal", () => {
  assert.deepEqual(transitionSpec("record"), { from: ["Draft", "Rejected"], to: "Recorded" });
  assert.deepEqual(transitionSpec("approve"), { from: ["Recorded"], to: "Approved" });
  assert.deepEqual(transitionSpec("reject"), { from: ["Recorded"], to: "Rejected" });
  assert.equal(transitionSpec("delete"), null);
  for (const action of ["record", "approve", "reject", "draft"]) {
    assert.equal(transitionSpec(action).from.includes("Approved"), false);
  }
});

test("expense CSV cells neutralize spreadsheet formula injection", () => {
  assert.equal(csvCell("=2+3"), '"\'=2+3"');
  assert.equal(csvCell("@SUM(A1:A2)"), '"\'@SUM(A1:A2)"');
  assert.equal(csvCell("normal"), '"normal"');
});
