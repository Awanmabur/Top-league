const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ejs = require("ejs");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("Announcement model and tenant registry expose canonical audiences, receipts and templates", () => {
  const model = read("src/models/tenant/Announcement.js");
  const loaders = read("src/models/tenant/loadModels.js");
  const receipt = read("src/models/tenant/AnnouncementReceipt.js");
  assert.match(model, /"All Parents"/);
  assert.match(model, /"Specific Program"/);
  assert.match(model, /"Specific Subject"/);
  assert.match(loaders, /AnnouncementReceipt: defineModel\("AnnouncementReceipt"\)/);
  assert.match(loaders, /AnnouncementTemplate: defineModel\("AnnouncementTemplate"\)/);
  assert.match(receipt, /\{ announcementId: 1, userId: 1 \}/);
  assert.match(receipt, /unique: true/);
});

test("all Student, Parent and Staff announcement consumers use the shared visibility service instead of find-all", () => {
  const files = [
    "src/controllers/tenant/students/dashboardController.js",
    "src/controllers/tenant/students/eventsController.js",
    "src/controllers/tenant/students/notificationsController.js",
    "src/controllers/tenant/parents/dashboardController.js",
    "src/controllers/tenant/parents/announcementsController.js",
    "src/controllers/tenant/staff/dashboardController.js",
    "src/controllers/tenant/staff/announcementsController.js",
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file));
    const text = source.toString("latin1");
    assert.match(text, /findVisibleAnnouncements/);
    assert.doesNotMatch(text, /Announcement\.find\(\{\}\)/);
  }
});

test("portal acknowledgement routes and forms are real", () => {
  assert.match(read("src/routes/tenant/students/notifications.js"), /\/announcements\/:id\/ack/);
  assert.match(read("src/routes/tenant/parents/announcements.js"), /\/announcements\/:id\/ack/);
  assert.match(read("src/routes/tenant/staff/announcements.js"), /\/announcements\/:id\/ack/);
  assert.match(read("views/students/notifications.ejs"), /Acknowledge/);
  assert.match(read("views/parents/announcements.ejs"), /Acknowledge/);
  assert.match(read("views/staff/announcements.ejs"), /Acknowledge/);
});

test("Admin Announcement routes implement export, templates and reminders", () => {
  const routes = read("src/routes/tenant/admin/announcements.js");
  assert.match(routes, /\/export\.csv/);
  assert.match(routes, /\/templates/);
  assert.match(routes, /\/:id\/remind/);
  const controller = read("src/controllers/tenant/admin/announcementsController.js");
  assert.match(controller, /exportCsv:/);
  assert.match(controller, /createTemplate:/);
  assert.match(controller, /deleteTemplate:/);
  assert.match(controller, /remind:/);
  assert.match(controller, /escapeRegex\(q\)/);
});

test("Admin Announcement JS no longer contains fake hook-later actions and escapes DB strings", () => {
  const js = read("public/js/announcements.js");
  assert.doesNotMatch(js, /Hook export route later/);
  assert.doesNotMatch(js, /Hook templates route later/);
  assert.doesNotMatch(js, /Hook settings route later/);
  assert.doesNotMatch(js, /Hook reminder\/send-notification logic later/);
  assert.match(js, /const esc =/);
  assert.match(js, /\/admin\/announcements\/export\.csv/);
  assert.match(js, /\/admin\/settings\?tab=communication/);
  assert.match(js, /\/remind/);
});

test("Announcement and portal EJS views compile after receipt/template/ack wiring", () => {
  const files = [
    "views/tenant/announcements/index.ejs",
    "views/students/notifications.ejs",
    "views/parents/announcements.ejs",
    "views/staff/announcements.ejs",
  ];
  for (const file of files) {
    assert.doesNotThrow(() => ejs.compile(read(file), { filename: path.join(root, file) }), file);
  }
});

test("Announcement Settings button lands on the existing Communication tab", () => {
  const js = read("public/js/settings.js");
  assert.match(js, /URLSearchParams\(window\.location\.search\)/);
  assert.match(js, /requestedTab/);
});


test("Announcement reminders use role-scoped notifications and targeted recipient resolution is complete", () => {
  const service = read("src/services/tenant/announcementService.js");
  const notificationModel = read("src/models/tenant/Notification.js");
  assert.match(notificationModel, /"parent"/);
  assert.match(service, /String\(receipt\.role/);
  assert.doesNotMatch(service, /audience:\s*"all",\s*\n\s*userId:\s*receipt\.userId/);
  assert.match(service, /type === "Specific Department"/);
  assert.match(service, /schoolUnitName/);
  assert.match(service, /Subject\.findOne/);
});

test("Admin audience filters expose every canonical audience without changing the page layout", () => {
  const view = read("views/tenant/announcements/index.ejs");
  assert.match(view, /value="All Parents"/);
  assert.match(view, /value="Specific Subject"/);
});

test("Student, Parent and Staff notification consumers use private-target-aware visibility filters", () => {
  const files = [
    "src/controllers/tenant/students/notificationsController.js",
    "src/controllers/tenant/parents/notificationsController.js",
    "src/controllers/tenant/staff/notificationsController.js",
    "src/controllers/tenant/parents/dashboardController.js",
    "src/controllers/tenant/staff/dashboardController.js",
  ];
  for (const file of files) {
    assert.match(read(file), /portalNotificationFilter/);
  }
  assert.match(read("src/controllers/tenant/parents/notificationsController.js"), /directNotificationOwnershipFilter/);
  assert.match(read("src/controllers/tenant/staff/notificationsController.js"), /directNotificationOwnershipFilter/);
});


test("scheduled announcements have a server scheduler, lease claim, and idempotent email recovery", () => {
  const model = read("src/models/tenant/Announcement.js");
  const service = read("src/services/tenant/announcementService.js");
  const scheduler = read("src/services/tenant/announcementScheduler.js");
  const index = read("src/index.js");
  assert.match(model, /scheduleClaimedAt/);
  assert.match(service, /findOneAndUpdate/);
  assert.match(service, /emailDeliveryStatus === "Sent"/);
  assert.match(scheduler, /processScheduledAnnouncements/);
  assert.match(index, /startAnnouncementScheduler/);
  assert.match(index, /stopAnnouncementScheduler/);
});

test("index creation migrates legacy announcement receipts before enforcing indexes", () => {
  const indexes = read("scripts/create-indexes.js");
  const pkg = JSON.parse(read("package.json"));
  assert.match(indexes, /migrateAnnouncements/);
  assert.equal(pkg.scripts["migrate:announcements"], "node scripts/migrate-announcements.js");
});


test("Admin announcement JSON bootstrap is RCDATA-safe against stored closing-tag injection", () => {
  const view = read("views/tenant/announcements/index.ejs");
  assert.match(view, /<%= JSON\.stringify\(announcements \|\| \[\]\) %>/);
  assert.match(view, /<%= JSON\.stringify\(templates \|\| \[\]\) %>/);
  assert.doesNotMatch(view, /<%- JSON\.stringify\(announcements/);
});

test("published audience edits synchronize receipts and expiry lifecycle is server-authoritative", () => {
  const service = read("src/services/tenant/announcementService.js");
  assert.match(service, /AnnouncementReceipt\.deleteMany\(staleFilter\)/);
  assert.match(service, /usersForParentsOfStudents/);
  assert.match(service, /usersForStudentAudience/);
  assert.match(service, /async function expireAnnouncements/);
  assert.match(service, /await expireAnnouncements\(req, now\)/);
});


test("Admin publish/update/reminder actions enforce the shared lifecycle instead of bypassing it", () => {
  const controller = read("src/controllers/tenant/admin/announcementsController.js");
  assert.match(controller, /const activated = await activateAnnouncement\(req, doc/);
  assert.match(controller, /Expired announcements cannot be published/);
  assert.match(controller, /await activateAnnouncement\(req, existing/);
  assert.match(controller, /remind: async[\s\S]*await publishDueAnnouncements\(req\)/);
});
