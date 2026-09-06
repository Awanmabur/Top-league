const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const privacy = fs.readFileSync(path.join(ROOT, 'views/platform/public/privacy.ejs'), 'utf8');

test('privacy policy keeps production page shell and current date', () => {
  assert.match(privacy, /<main class="page" aria-label="Privacy policy">/);
  assert.match(privacy, /<%- include\("\.\.\/partials\/footer"\) %>/);
  assert.match(privacy, /September 06, 2026/);
  assert.doesNotMatch(privacy, /Template text/i);
  assert.doesNotMatch(privacy, /Privacy Policy Generator/i);
});

test('privacy policy contains Google Calendar OAuth disclosures required for production', () => {
  for (const required of [
    'Google User Data — Access, Use, Storage, Sharing and Deletion',
    'https://www.googleapis.com/auth/calendar.events.owned',
    'https://www.googleapis.com/auth/calendar.events.freebusy',
    'free/busy availability',
    'encrypted form',
    'does not sell Google user data',
    'generalized or non-personalized artificial-intelligence or machine-learning models',
    "revoke Classic Academy's access",
    'Google API Services User Data Policy',
    'Limited Use requirements',
  ]) assert.ok(privacy.includes(required), `missing privacy disclosure: ${required}`);
});

test('privacy policy covers retention deletion security and minors accurately', () => {
  for (const required of [
    'Retention of Your Personal Data',
    'Delete Your Personal Data',
    'Security of Your Personal Data',
    "Children's and Minors' Privacy",
    'school-management services that may process information about students and other minors',
  ]) assert.ok(privacy.includes(required), `missing privacy section: ${required}`);
});

test('download-wrapper scripts are not copied into production privacy page', () => {
  assert.doesNotMatch(privacy, /kaspersky-labs/i);
  assert.doesNotMatch(privacy, /cdn-cgi\/scripts/i);
  assert.doesNotMatch(privacy, /data-cfemail/i);
});
