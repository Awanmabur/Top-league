const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ejs = require("ejs");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("Messaging models expose canonical audience, recipient and template contracts", () => {
  const message = read("src/models/tenant/Message.js");
  const recipient = read("src/models/tenant/MessageRecipient.js");
  const template = read("src/models/tenant/MessageTemplate.js");
  const registry = read("src/models/tenant/loadModels.js");
  assert.match(message, /Specific Program/);
  assert.match(message, /Specific Subject/);
  assert.match(message, /scheduleClaimedAt/);
  assert.match(recipient, /messageId: 1, userId: 1.*unique: true/s);
  assert.match(template, /MessageTemplate/);
  assert.match(registry, /MessageRecipient/);
  assert.match(registry, /MessageTemplate/);
});

test("Admin Messaging routes implement export, templates, reminder and real send actions", () => {
  const routes = read("src/routes/tenant/admin/messaging.js");
  const controller = read("src/controllers/tenant/admin/messagingController.js");
  assert.match(routes, /get\("\/export\.csv", ctrl\.exportCsv\)/);
  assert.match(routes, /post\("\/templates", ctrl\.createTemplate\)/);
  assert.match(routes, /post\("\/templates\/:id\/delete", ctrl\.deleteTemplate\)/);
  assert.match(routes, /post\("\/:id\/remind", ctrl\.remind\)/);
  assert.match(controller, /dispatchMessage/);
  assert.match(controller, /resendOrRemind/);
  assert.doesNotMatch(controller, /new RegExp\(q,/);
});

test("Admin Messaging JS removes hook-later actions and escapes database strings before dynamic HTML", () => {
  const js = read("public/js/messaging.js");
  assert.doesNotMatch(js, /Hook export route later|Hook templates route later|Hook settings route later|Hook resend\/reminder logic later/);
  assert.match(js, /const esc =/);
  assert.match(js, /\$\{esc\(m\.subject\)\}/);
  assert.match(js, /\$\{esc\(r\.user \|\| "—"\)\}/);
  assert.match(js, /\/admin\/settings\?tab=communication/);
  assert.match(js, /\/admin\/messaging\/export\.csv/);
  assert.match(js, /\/remind/);
});

test("Admin Messaging JSON bootstrap is RCDATA-safe and Templates reuse the approved modal system", () => {
  const view = read("views/tenant/messaging/index.ejs");
  assert.match(view, /id="mTemplates"/);
  assert.match(view, /id="templatesData"/);
  assert.match(view, /<%= JSON\.stringify\(messages \|\| \[\]\) %>/);
  assert.match(view, /<%= JSON\.stringify\(templates \|\| \[\]\) %>/);
  assert.doesNotMatch(view, /<%- JSON\.stringify\(messages/);
  ejs.compile(view, { filename: path.join(root, "views/tenant/messaging/index.ejs") });
});

test("scheduled Messaging has a server scheduler and message migration runs before indexes", () => {
  const scheduler = read("src/services/tenant/messageScheduler.js");
  const index = read("src/index.js");
  const indexes = read("scripts/create-indexes.js");
  const pkg = JSON.parse(read("package.json"));
  assert.match(scheduler, /processDueMessages/);
  assert.match(scheduler, /DISABLE_MESSAGE_SCHEDULER/);
  assert.match(index, /startMessageScheduler\(\)/);
  assert.match(index, /stopMessageScheduler\(\)/);
  assert.match(indexes, /migrateMessages\(tenantModels\)/);
  assert.equal(pkg.scripts["migrate:messages"], "node scripts/migrate-messages.js");
});

test("portal read actions update real MessageRecipient open receipts", () => {
  const studentRoutes = read("src/routes/tenant/students/notifications.js");
  const studentController = read("src/controllers/tenant/students/notificationsController.js");
  const staffController = read("src/controllers/tenant/staff/notificationsController.js");
  const studentView = read("views/students/notifications.ejs");
  assert.match(studentRoutes, /\/notifications\/:id\/read/);
  assert.match(studentController, /markMessageOpenedFromNotification/);
  assert.match(staffController, /markMessageOpenedFromNotification/);
  assert.match(studentView, /\/student\/notifications\/<%= item\.id %>\/read/);
});

test("Message delivery prunes stale audience notifications and refreshes existing portal message content", () => {
  const service = read("src/services/tenant/messageService.js");
  assert.match(service, /staleNotificationFilter/);
  assert.match(service, /Notification\.updateMany/);
  assert.match(service, /message: str\(message\.body\)\.slice\(0, 5000\)/);
  assert.match(service, /\$setOnInsert:[\s\S]*createdBy/);
});


test("scheduled delivery commits Sent only after channel work and Sender Name/Reply-To reach email headers", () => {
  const service = read("src/services/tenant/messageService.js");
  const mailer = read("src/utils/mailer.js");
  const dispatchStart = service.indexOf("async function dispatchMessage");
  const dispatchEnd = service.indexOf("async function processDueMessages");
  const dispatch = service.slice(dispatchStart, dispatchEnd);
  assert.ok(dispatch.indexOf("deliverPortalChannel") < dispatch.indexOf('message.status = "Sent"'));
  assert.ok(dispatch.indexOf("deliverEmailChannel") < dispatch.indexOf('message.status = "Sent"'));
  assert.match(service, /replyTo: str\(message\.replyTo\)/);
  assert.match(service, /fromName: str\(message\.senderName\)/);
  assert.match(mailer, /replyTo/);
  assert.match(mailer, /fromName/);
});

test("message reminders honor the selected portal channel", () => {
  const service = read("src/services/tenant/messageService.js");
  assert.match(service, /if \(Notification && message\.channels\?\.portal\)/);
});


test("Messaging access fails closed unless both Message and Notification modules exist", () => {
  const routes = read("src/routes/tenant/admin/index.js");
  const navbar = read("views/tenant/partials/navbar.ejs");
  const dashboard = read("src/controllers/tenant/admin/dashboardController.js");
  assert.match(routes, /requireTenantModule\("Message"\).*requireTenantModule\("Notification"\)/);
  assert.match(navbar, /!hasModule\("Message"\) \|\| !hasModule\("Notification"\)/);
  assert.match(dashboard, /hasAnyModel\("Message"\) && hasAnyModel\("Notification"\)/);
});
