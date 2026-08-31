const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ejs = require("ejs");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("tenant registry exposes canonical Hostel allocation and application models", () => {
  const src = read("src/models/tenant/loadModels.js");
  assert.match(src, /Hostel:\s*defineModel\("Hostel"\)/);
  assert.match(src, /HostelAllocation:\s*defineModel\("HostelAllocation"\)/);
  assert.match(src, /HostelApplication:\s*defineModel\("HostelApplication"\)/);
});

test("HostelAllocation has one-active-room database enforcement and legacy-id idempotency", () => {
  const src = read("src/models/tenant/HostelAllocation.js");
  assert.match(src, /\{ student: 1, status: 1 \}/);
  assert.match(src, /unique:\s*true/);
  assert.match(src, /legacyCheckinId/);
  assert.match(src, /ref:\s*"Hostel"/);
});

test("HostelApplication persists authoritative student and room ownership with a unique application number", () => {
  const src = read("src/models/tenant/HostelApplication.js");
  assert.match(src, /applicationId/);
  assert.match(src, /\{ applicationId: 1 \}, \{ unique: true \}/);
  assert.match(src, /studentId/);
  assert.match(src, /isCurrent/);
});

test("student hostel route exposes a real POST application workflow", () => {
  const route = read("src/routes/tenant/students/hostel.js");
  const controller = read("src/controllers/tenant/students/hostelController.js");
  const view = read("views/students/hostel.ejs");
  assert.match(route, /router\.post\("\/hostel\/apply"/);
  assert.match(controller, /createApplication/);
  assert.match(view, /action="\/student\/hostel\/apply"/);
  assert.doesNotMatch(view, /Apply \/ Change Hostel[\s\S]{0,100}disabled/);
});

test("admin Hostel routes implement export, report, policies, allocation, checkout and maintenance lifecycle", () => {
  const route = read("src/routes/tenant/admin/hostels.js");
  for (const expected of ["/export.csv", "/report", "/policies", "/rooms/:id/allocate", "/allocations/:allocationId/vacate", "/maintenance/:ticketId/status"]) {
    assert.ok(route.includes(expected), `missing ${expected}`);
  }
});

test("active Hostel browser script contains no hook-later alerts and wires the approved controls", () => {
  const src = read("public/js/tenant-admin-hostels.js");
  assert.doesNotMatch(src, /can be wired next|page can be added next|alert\(/i);
  assert.match(src, /\/admin\/hostels\/export\.csv/);
  assert.match(src, /\/admin\/hostels\/report/);
  assert.match(src, /openModal\("mPolicies"\)/);
});

test("Hostel room JSON attributes are HTML escaped rather than raw-unescaped EJS", () => {
  const view = read("views/tenant/hostels/index.ejs");
  assert.doesNotMatch(view, /data-room='<%-\s*JSON\.stringify/);
  assert.match(view, /data-room='<%=\s*JSON\.stringify/);
});

test("hostel check-in and maintenance tables expose real server actions", () => {
  const view = read("views/tenant/hostels/index.ejs");
  assert.match(view, /\/admin\/hostels\/allocations\/<%= c\.allocationId \|\| c\._id %>\/vacate/);
  assert.match(view, /\/admin\/hostels\/rooms\/<%= m\.roomMongoId %>\/maintenance\/<%= m\._id %>\/status/);
});


test("Hostel application UI hides lifecycle actions after terminal states and only allocates current approvals", () => {
  const view = read("views/tenant/hostels/index.ejs");
  assert.match(view, /\["Pending", "Waitlist"\]\.includes\(a\.status\)/);
  assert.match(view, /a\.status === "Approved" && a\.isCurrent === true/);
  assert.match(view, /a\.status === "Allocated"/);
  assert.match(view, /a\.status === "Cancelled"/);
});

test("Hostel migration runs before tenant index creation and has a standalone command", () => {
  const indexes = read("scripts/create-indexes.js");
  const pkg = JSON.parse(read("package.json"));
  assert.match(indexes, /migrateHostels\(tenantModels\)/);
  assert.equal(pkg.scripts["migrate:hostels"], "node scripts/migrate-hostels.js");
  assert.ok(fs.existsSync(path.join(root, "scripts/lib/migrateHostels.js")));
});

test("Hostel report print action is CSP-safe and does not use inline onclick", () => {
  const view = read("views/tenant/hostels/report.ejs");
  assert.doesNotMatch(view, /onclick=/);
  assert.match(view, /\/js\/hostel-report\.js/);
  assert.match(read("public/js/hostel-report.js"), /window\.print/);
});

test("changed Hostel views compile", () => {
  for (const file of ["views/tenant/hostels/index.ejs", "views/tenant/hostels/report.ejs", "views/students/hostel.ejs"]) {
    assert.doesNotThrow(() => ejs.compile(read(file), { filename: path.join(root, file) }), file);
  }
});
