const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('OAuth connect uses protected GET navigation instead of POST form redirect', () => {
  const routes = read('src/routes/platform/settings.js');
  const view = read('views/platform/settings/index.ejs');
  assert.match(routes, /router\.get\("\/super-admin\/settings\/google-calendar\/connect", platformRequire\("settings\.manage"\), googleCalendarController\.connect\)/);
  assert.doesNotMatch(routes, /router\.post\("\/super-admin\/settings\/google-calendar\/connect"/);
  assert.match(view, /<a class="btn" href="\/super-admin\/settings\/google-calendar\/connect">/);
  assert.doesNotMatch(view, /<form action="\/super-admin\/settings\/google-calendar\/connect" method="POST"/);
});

test('strict form-action CSP stays self-only', () => {
  const index = read('src/index.js');
  assert.match(index, /"form-action": \["'self'"\]/);
  assert.doesNotMatch(index, /form-action[^\n]+accounts\.google\.com/);
});

test('OAuth state and PKCE verifier are saved before leaving Classic Academy', () => {
  const controller = read('src/controllers/platform/googleCalendarController.js');
  assert.match(controller, /req\.session\.googleCalendarOauthState = pending\.state/);
  assert.match(controller, /req\.session\.googleCalendarOauthVerifier = pending\.verifier/);
  assert.match(controller, /await saveSession\(req\)/);
  assert.match(controller, /res\.redirect\(302, googleCalendar\.authorizationUrl\(pending\)\)/);
});

test('settings page displays Google success and error flash messages', () => {
  const view = read('views/platform/settings/index.ejs');
  assert.match(view, /flashMessages\.success/);
  assert.match(view, /flashMessages\.error/);
});
