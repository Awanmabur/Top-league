const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ejs = require("ejs");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("Admin Settings exposes real save, reset-defaults and configuration-test routes", () => {
  const routes = read("src/routes/tenant/admin/settings.js");
  assert.match(routes, /post\("\/", ctrl\.save\)/);
  assert.match(routes, /post\("\/reset", ctrl\.resetDefaults\)/);
  assert.match(routes, /post\("\/test", ctrl\.testConfiguration\)/);
});

test("Settings controller validates persistence and performs a real email configuration test", () => {
  const controller = read("src/controllers/tenant/admin/settingsController.js");
  assert.match(controller, /normalizeSettingsInput/);
  assert.match(controller, /validateSettings/);
  assert.match(controller, /buildDefaultSettings\(req\.tenant\)/);
  assert.match(controller, /buildConfigurationReport/);
  assert.match(controller, /await sendMail\(/);
  assert.match(controller, /runValidators: true/);
});

test("Settings client has no hook-later actions and submits the existing controls to real routes", () => {
  const js = read("public/js/settings.js");
  assert.doesNotMatch(js, /Hook reset defaults route later|Hook test configuration actions later/);
  assert.match(js, /resetDefaultsForm/);
  assert.match(js, /testConfigForm/);
  assert.match(js, /requestSubmit\(\)/);
  assert.match(js, /window\.confirm/);
});

test("Settings JSON bootstrap is RCDATA-safe and reset/test forms preserve CSRF", () => {
  const view = read("views/tenant/settings/index.ejs");
  assert.match(view, /action="\/admin\/settings\/reset"/);
  assert.match(view, /action="\/admin\/settings\/test"/);
  assert.match(view, /name="_csrf" value="<%= csrfToken %>"/);
  assert.match(view, /<%= JSON\.stringify\(settings \|\| \{\}\) %>/);
  assert.doesNotMatch(view, /<%- JSON\.stringify\(settings/);
  assert.doesNotThrow(() => ejs.compile(view, { filename: path.join(root, "views/tenant/settings/index.ejs") }));
});

test("Active Settings route stays admin/model gated and renders the approved Settings index", () => {
  const admin = read("src/routes/tenant/admin/index.js");
  const controller = read("src/controllers/tenant/admin/settingsController.js");
  assert.match(admin, /router\.use\("\/settings", requireTenantAuth\("admin"\), requireTenantModule\("Setting"\)/);
  assert.match(controller, /res\.render\("tenant\/settings\/index"/);
});
