const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

test("featured schools shows wide 3.5-card treatment without descriptions", () => {
  const view = read("views/platform/public/index.ejs");
  assert.match(view, /width:\s*clamp\(320px, 25vw, 480px\)/);
  assert.match(view, /class="school-card-media"/);
  assert.match(view, /school\.verified === true/);
  assert.doesNotMatch(view, /<p><%= school\.description %><\/p>/);
  assert.match(view, /bottom:\s*\.75rem/);
  assert.match(view, /left:\s*\.75rem/);
});

test("featured-school projection exposes verified state", () => {
  const src = read("src/controllers/platform/schoolsPublicController.js");
  assert.match(src, /verified:\s*profile\.verified === true/);
});

test("platform and tenant logins are touching two-card layouts", () => {
  for (const file of ["views/platform/auth/login.ejs", "views/tenant/auth/login.ejs"]) {
    const view = read(file);
    assert.match(view, /class="login-shell"/);
    assert.match(view, /grid-template-columns:1fr 1fr/);
    assert.match(view, /gap:0/);
    assert.match(view, /border-radius:var\(--radius\)/);
    assert.match(view, /overflow:hidden/);
    assert.match(view, /id="loginForm"/);
    assert.match(view, /name="_csrf"/);
  }
});

test("tenant login reads tenant branding and profile identity", () => {
  const view = read("views/tenant/auth/login.ejs");
  assert.match(view, /settings\.branding/);
  assert.match(view, /profile\.shortName/);
  assert.match(view, /branding\.logoUrl/);
  assert.match(view, /branding\.coverUrl/);
});

test("tenant public home is driven by sanitized tenant customization", () => {
  const ctrl = read("src/controllers/tenant/tenant/tenantController.js");
  const view = read("views/tenant/public/index.ejs");
  assert.match(ctrl, /sanitizePublicBranding/);
  assert.match(ctrl, /sanitizePublicProfileForRender/);
  assert.match(ctrl, /settings\.academics/);
  assert.match(ctrl, /const publicHome = buildPublicHome\(tenant\)/);
  assert.match(ctrl, /publicCanonicalUrl/);
  assert.match(view, /p\.shortName/);
  assert.match(view, /b\.logoUrl/);
  assert.match(view, /b\.coverUrl/);
  assert.match(view, /h\.programs/);
  assert.match(view, /h\.gallery/);
  assert.match(view, /h\.announcements/);
  assert.match(view, /admissions\.applyUrl/);
  assert.doesNotMatch(view, /School of Juba/);
  assert.doesNotMatch(view, /\+211 XXX/);
  assert.doesNotMatch(view, /UI only now/);
});
