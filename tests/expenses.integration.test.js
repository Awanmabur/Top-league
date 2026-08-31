const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ejs = require("ejs");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("Expense model has unique numbers, bounded financial fields and approval audit metadata", () => {
  const model = read("src/models/tenant/Expense.js");
  assert.match(model, /expenseNumber: 1.*unique: true/s);
  assert.match(model, /approvedAt/);
  assert.match(model, /approvedBy/);
  assert.match(model, /rejectedAt/);
  assert.match(model, /rejectedBy/);
  assert.match(model, /maxlength: 3000/);
});

test("Admin Expenses implements filter-safe CSV export and lifecycle-controlled mutations", () => {
  const routes = read("src/routes/tenant/admin/expenses.js");
  const controller = read("src/controllers/tenant/admin/expensesController.js");
  assert.match(routes, /get\("\/export\.csv", ctrl\.exportCsv\)/);
  assert.match(controller, /buildExpenseFilters\(req\.query\)/);
  assert.match(controller, /generateExpenseNumber/);
  assert.match(controller, /status: \{ \$in: spec\.from \}/);
  assert.match(controller, /status: \{ \$ne: "Approved" \}/);
  assert.match(controller, /Approved expenses are locked/);
  assert.match(controller, /Invalid bulk expense action/);
});

test("Expenses client uses safe DOM rendering and real filtered Export", () => {
  const js = read("public/js/expenses.js");
  assert.doesNotMatch(js, /Hook expenses export route later/);
  assert.doesNotMatch(js, /\.innerHTML\s*=/);
  assert.match(js, /replaceChildren\(\)/);
  assert.match(js, /textContent/);
  assert.match(js, /\/admin\/expenses\/export\.csv/);
  assert.match(js, /expense\.status !== "Approved"/);
});

test("Expenses JSON bootstrap is RCDATA-safe and approved UI still compiles", () => {
  const view = read("views/tenant/finance/expenses.ejs");
  assert.match(view, /<%= JSON\.stringify\(expenses \|\| \[\]\) %>/);
  assert.doesNotMatch(view, /<%- JSON\.stringify\(expenses/);
  assert.doesNotThrow(() => ejs.compile(view, { filename: path.join(root, "views/tenant/finance/expenses.ejs") }));
});

test("expense migration runs before index creation and has an explicit deployment command", () => {
  const indexes = read("scripts/create-indexes.js");
  const pkg = JSON.parse(read("package.json"));
  assert.match(indexes, /migrateExpenses\(tenantModels\)/);
  assert.ok(indexes.indexOf("migrateExpenses(tenantModels)") < indexes.indexOf("createModelIndexes(label, tenantModels)"));
  assert.equal(pkg.scripts["migrate:expenses"], "node scripts/migrate-expenses.js");
});

test("Expenses remains permission/model gated in Admin routing", () => {
  const admin = read("src/routes/tenant/admin/index.js");
  assert.match(admin, /router\.use\("\/expenses", requireTenantPermission\("finance\.view"\), requireTenantModule\("Expense"\)/);
});
