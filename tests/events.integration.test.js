const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ejs = require("ejs");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("Event models expose registrations, templates, subscriptions, unique views and Specific Program targeting", () => {
  const event = read("src/models/tenant/Event.js");
  const registration = read("src/models/tenant/EventRegistration.js");
  const view = read("src/models/tenant/EventView.js");
  const subscription = read("src/models/tenant/EventSubscription.js");
  const registry = read("src/models/tenant/loadModels.js");
  assert.match(event, /Specific Program/);
  assert.match(event, /scheduleClaimedAt/);
  assert.match(registration, /eventId: 1, identityKey: 1.*unique: true/s);
  assert.match(view, /eventId: 1, userId: 1.*unique: true/s);
  assert.match(subscription, /userId:.*unique: true/s);
  assert.match(registry, /EventRegistration: defineModel\("EventRegistration"\)/);
  assert.match(registry, /EventTemplate: defineModel\("EventTemplate"\)/);
  assert.match(registry, /EventSubscription: defineModel\("EventSubscription"\)/);
  assert.match(registry, /EventView: defineModel\("EventView"\)/);
});

test("Admin Events routes implement export, templates, reminders, lifecycle, bulk actions and check-in", () => {
  const routes = read("src/routes/tenant/admin/events.js");
  const controller = read("src/controllers/tenant/admin/eventsController.js");
  assert.match(routes, /get\("\/export\.csv", ctrl\.exportCsv\)/);
  assert.match(routes, /post\("\/templates", ctrl\.createTemplate\)/);
  assert.match(routes, /post\("\/templates\/:id\/delete", ctrl\.deleteTemplate\)/);
  assert.match(routes, /post\("\/:id\/remind", ctrl\.remind\)/);
  assert.match(routes, /registrations\/:registrationId\/check-in/);
  assert.match(controller, /activateEvent/);
  assert.match(controller, /cancelEventAndNotify/);
  assert.match(controller, /buildEventQuery\(req\.query\)/);
  assert.match(controller, /escapeRegex\(q\)/);
});

test("Admin Events client has no hook-later controls or database-backed innerHTML rendering", () => {
  const js = read("public/js/events.js");
  assert.doesNotMatch(js, /Hook export route later|Hook templates route later|Hook settings route later|Hook reminder\/send-notification logic later/);
  assert.doesNotMatch(js, /\.innerHTML\s*=/);
  assert.match(js, /replaceChildren\(\)/);
  assert.match(js, /textContent/);
  assert.match(js, /\/admin\/events\/export\.csv/);
  assert.match(js, /\/admin\/settings\?tab=communication/);
  assert.match(js, /\/registrations\/.*\/check-in/);
  assert.match(js, /\/remind/);
});

test("Admin Events JSON bootstrap is RCDATA-safe and existing UI now contains real Templates and attendance actions", () => {
  const view = read("views/tenant/events/index.ejs");
  assert.match(view, /id="mTemplates"/);
  assert.match(view, /id="eventTemplatesBody"/);
  assert.match(view, /id="reminderForm"/);
  assert.match(view, />Action<\/th>/);
  assert.match(view, /<%= JSON\.stringify\(events \|\| \[\]\) %>/);
  assert.match(view, /<%= JSON\.stringify\(templates \|\| \[\]\) %>/);
  assert.doesNotMatch(view, /<%- JSON\.stringify\(events/);
  assert.doesNotThrow(() => ejs.compile(view, { filename: path.join(root, "views/tenant/events/index.ejs") }));
});

test("Student Events uses shared audience visibility, real registration, calendar and alert persistence", () => {
  const controller = read("src/controllers/tenant/students/eventsController.js");
  const routes = read("src/routes/tenant/students/events.js");
  assert.match(controller, /findVisibleEvents/);
  assert.doesNotMatch(controller, /Event\.find\(\{\}\)/);
  assert.match(controller, /registerForEvent/);
  assert.match(controller, /cancelRegistration/);
  assert.match(controller, /toggleEventSubscription/);
  assert.match(controller, /buildEventsIcs/);
  assert.match(routes, /events\/calendar\.ics/);
  assert.match(routes, /events\/alerts/);
  assert.match(routes, /:id\/register/);
});

test("Student Events filters run from a same-origin external script compatible with production CSP", () => {
  const view = read("views/students/events.ejs");
  const js = read("public/js/student-events.js");
  assert.match(view, /<script src="\/js\/student-events\.js"><\/script>/);
  assert.doesNotMatch(view, /<script>\s*\(function\(\)/);
  assert.match(js, /eventType/);
  assert.match(js, /eventLocation/);
  assert.match(js, /row\.style\.display/);
  assert.doesNotThrow(() => ejs.compile(view, { filename: path.join(root, "views/students/events.ejs") }));
});

test("scheduled Events have a recoverable server scheduler and migration runs before index enforcement", () => {
  const scheduler = read("src/services/tenant/eventScheduler.js");
  const service = read("src/services/tenant/eventService.js");
  const index = read("src/index.js");
  const indexes = read("scripts/create-indexes.js");
  const pkg = JSON.parse(read("package.json"));
  assert.match(scheduler, /processScheduledEvents/);
  assert.match(scheduler, /DISABLE_EVENT_SCHEDULER/);
  assert.match(service, /scheduleClaimedAt/);
  assert.match(service, /staleBefore/);
  assert.match(index, /startEventScheduler\(\)/);
  assert.match(index, /stopEventScheduler\(\)/);
  assert.match(indexes, /migrateEvents\(tenantModels\)/);
  assert.equal(pkg.scripts["migrate:events"], "node scripts/migrate-events.js");
});

test("Event notifications and reminders use portal-appropriate links and active lifecycle checks", () => {
  const service = read("src/services/tenant/eventService.js");
  const controller = read("src/controllers/tenant/admin/eventsController.js");
  assert.match(service, /isStudentUser\(user\) \? "\/student\/events" : "\/staff\/notifications"/);
  assert.match(controller, /item\.status !== "Published"/);
  assert.match(service, /status: "Published"[\s\S]*endAt: \{ \$gt: now \}/);
});

test("Events access is admin/model gated and Student route fails closed on companion event models", () => {
  const admin = read("src/routes/tenant/admin/index.js");
  const students = read("src/routes/tenant/students/index.js");
  assert.match(admin, /router\.use\("\/events", requireTenantAuth\("admin"\), requireTenantModule\("Event"\)/);
  assert.match(students, /requireTenantModels\(\["Event", "EventRegistration", "EventSubscription", "EventView"\], \{ match: "all" \}\)/);
});
