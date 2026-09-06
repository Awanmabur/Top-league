'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const VIEWS = path.join(ROOT, 'views');
const PUBLIC = path.join(VIEWS, 'platform', 'public');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}


function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function publicBodyStructure(source) {
  let html = source.replace(/<%[\s\S]*?%>/g, 'EJS');
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (body) html = body[1];
  html = html.replace(/<footer\b[\s\S]*?<\/footer>/gi, '');
  const tokens = [];
  for (const match of html.matchAll(/<(?!\/)([a-zA-Z][\w:-]*)([^>]*)>/gs)) {
    const tag = match[1].toLowerCase();
    if (new Set(['script','style','link','meta','title','source']).has(tag)) continue;
    const attrs = [];
    for (const attr of match[2].matchAll(/\b(class|id)\s*=\s*(["'])(.*?)\2/gis)) {
      attrs.push(`${attr[1].toLowerCase()}=${attr[3].trim().replace(/\s+/g, ' ')}`);
    }
    tokens.push(`${tag}|${attrs.join('|')}`);
  }
  return tokens.join('\n');
}

function publicPrimaryStyle(source) {
  const normalized = source.replace(/\r\n/g, '\n');
  const match = normalized.match(/<style[^\n]*>\n([\s\S]*?)<\/style>/i);
  if (!match) return '';
  return match[1]
    .split('\n')
    .filter((line) => !line.includes('@import url("https://fonts.googleapis.com/'))
    .map((line) => line.replace(/\s+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function walkEjs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkEjs(full));
    else if (entry.isFile() && entry.name.endsWith('.ejs')) out.push(full);
  }
  return out;
}


test('public content structure and primary styling remain locked to the user-approved good-looking baseline', () => {
  const manifest = JSON.parse(read('tests/fixtures/approved-good-looking-public-visual-baseline.json'));
  const names = fs.readdirSync(PUBLIC).filter((name) => name.endsWith('.ejs')).sort();
  assert.deepEqual(names, Object.keys(manifest.pages).sort());
  for (const name of names) {
    const source = fs.readFileSync(path.join(PUBLIC, name), 'utf8');
    const expected = manifest.pages[name];
    assert.equal(sha256(publicBodyStructure(source)), expected.bodyStructureSha256, `${name}: user-approved page structure drifted`);
    assert.equal(sha256(publicPrimaryStyle(source)), expected.primaryStyleSha256, `${name}: user-approved primary styling drifted`);
  }
});

test('user-approved public visual variable blocks are not corrupted by removed Google Fonts imports', () => {
  const affected = ['security','integrations','terms','services','contact','blog','careers','search'];
  for (const name of affected) {
    const source = read(`views/platform/public/${name}.ejs`);
    assert.doesNotMatch(source, /}\s*0,400;0,500;/, `${name}.ejs has a corrupted CSS token tail`);
    assert.match(source, /:root\s*\{/, `${name}.ejs is missing its root variable block`);
    assert.match(source, /--primary:\s*#4a90e2/i, `${name}.ejs lost the approved primary color variable`);
  }
});

test('templates contain no CSP-blocked inline event attributes', () => {
  const inlineHandler = /\s(?:onclick|onchange|onsubmit|oninput|onerror|onload)\s*=/i;
  const offenders = [];
  for (const file of walkEjs(VIEWS)) {
    const source = fs.readFileSync(file, 'utf8');
    if (inlineHandler.test(source)) offenders.push(path.relative(ROOT, file));
  }
  assert.deepEqual(offenders, []);
});

test('scholarship document links keep safeUrl output inside a valid href attribute', () => {
  const source = read('views/tenant/scholarships/application-view.ejs');
  assert.doesNotMatch(source, /safeUrl\([^)]*\)\s*%\s+rel=/);
  assert.match(source, /href="<%= safeUrl\(app\.transcript\.url\) %>" rel="noopener noreferrer"/);
  assert.match(source, /href="<%= safeUrl\(app\.idDocument\.url\) %>" rel="noopener noreferrer"/);
  assert.match(source, /href="<%= safeUrl\(app\.recommendationLetter\.url\) %>" rel="noopener noreferrer"/);
  assert.match(source, /href="<%= safeUrl\(d\.url\) %>" rel="noopener noreferrer"/);
});

test('all public pages keep exactly one shared main-site footer', () => {
  const files = fs.readdirSync(PUBLIC).filter((name) => name.endsWith('.ejs'));
  assert.equal(files.length, 25);
  for (const name of files) {
    const source = fs.readFileSync(path.join(PUBLIC, name), 'utf8');
    const includes = source.match(/partials\/footer/g) || [];
    assert.equal(includes.length, 1, `${name} must include the shared footer exactly once`);
  }
});

test('shared footer is byte-faithful to the approved main-page badge sources, sizes and order', () => {
  const source = read('views/platform/partials/footer.ejs');
  const google = 'https://upload.wikimedia.org/wikipedia/commons/7/78/Google_Play_Store_badge_EN.svg';
  const apple = 'https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg';
  assert.match(source, /Google_Play_Store_badge_EN\.svg/);
  assert.match(source, /developer\.apple\.com\/assets\/elements\/badges\/download-on-the-app-store\.svg/);
  assert.ok(source.indexOf(google) < source.indexOf(apple));
  assert.match(source, /style="height: 50px; width: 150px" alt="Google Play"/);
  assert.match(source, /alt="Download on the App Store" style="height: 50px;"/);
  assert.doesNotMatch(source, /store-badges|store-link|google-play-badge|app-store-badge/);
});

test('shared dashboard and application CSS remains locked to the user-approved good-looking upload', () => {
  const manifest = JSON.parse(read('tests/fixtures/approved-good-looking-css-baseline.json'));
  for (const [relativePath, expectedHash] of Object.entries(manifest.files)) {
    const normalized = read(relativePath).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    assert.equal(sha256(normalized), expectedHash, `${relativePath}: approved CSS drifted`);
  }
});

test('approved marketing imagery stays distinct and generic Key Features fallback is forbidden', () => {
  const about = read('views/platform/public/about.ejs');
  assert.match(about, /https:\/\/picsum\.photos\/seed\/admissions\/1200\/700/);
  assert.match(about, /https:\/\/picsum\.photos\/seed\/finance\/1200\/700/);
  assert.match(about, /https:\/\/picsum\.photos\/seed\/exams\/1200\/700/);
  const features = read('public/pages/features.js');
  assert.match(features, /finance-ca\/1200\/700/);
  assert.match(features, /security-ca\/1200\/700/);
  assert.doesNotMatch(features, /\/img\/feature\.(?:webp|png)/);
  const gallery = read('views/tenant/public/schools/view.ejs');
  assert.match(gallery, /data-src="<%= img %>"/);
  assert.doesNotMatch(gallery, /img \|\| ['"]\/img\/feature/);
  for (const name of fs.readdirSync(path.join(ROOT, 'views/platform/public')).filter((f) => f.endsWith('.ejs'))) {
    assert.doesNotMatch(read(`views/platform/public/${name}`), /public-image-fallback\.js/);
  }
  assert.equal(fs.existsSync(path.join(ROOT, 'public/js/public-image-fallback.js')), false);
});

test('admissions settings preview does not inject user-authored template text as HTML', () => {
  const source = read('views/tenant/settings/settings.ejs');
  assert.doesNotMatch(source, /templatePreview['"]\)\.innerHTML/);
  assert.match(source, /strong\.textContent = sub/);
  assert.match(source, /paragraph\.textContent = body/);
});
