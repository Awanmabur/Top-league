'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const baseline = JSON.parse(read('tests/fixtures/user-approved-media-baseline.json'));

function pageImageSources(source) {
  return [...source.matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gis)].map((m) => m[1]);
}

test('every public page keeps the exact approved non-footer image source sequence', () => {
  for (const [name, expected] of Object.entries(baseline.public_page_image_sources_excluding_shared_footer)) {
    const actual = pageImageSources(read(`views/platform/public/${name}`));
    assert.deepEqual(actual, expected, `${name}: visible image source drifted from user-approved upload`);
  }
});


function pageImageMarkupSha256(source) {
  const tags = [...source.matchAll(/<img\b[^>]*>/gis)].map((m) => m[0].trim()).join('\n');
  return require('node:crypto').createHash('sha256').update(tags).digest('hex');
}

test('every public page keeps the exact approved non-footer image markup and geometry', () => {
  for (const [name, expectedHash] of Object.entries(baseline.public_page_image_markup_sha256_excluding_shared_footer)) {
    const actual = pageImageMarkupSha256(read(`views/platform/public/${name}`));
    assert.equal(actual, expectedHash, `${name}: image markup/geometry drifted from user-approved upload`);
  }
});

test('dynamic feature panels keep separate approved images instead of repeating Key Features art', () => {
  const source = read('public/pages/features.js');
  const actual = [...source.matchAll(/\bimg:\s*["']([^"']+)["']/g)].map((m) => m[1]).slice(0, baseline.dynamic.features.length);
  assert.deepEqual(actual, baseline.dynamic.features);
  assert.equal(actual.filter((v) => /feature\.(?:png|webp)$/.test(v)).length, 0);
});

test('both blog renderers keep the three distinct approved covers', () => {
  for (const file of ['public/pages/blog.js','public/js/blog.js']) {
    const source = read(file);
    const actual = [...source.matchAll(/\bcover:\s*["']([^"']+)["']/g)].map((m) => m[1]).slice(0,3);
    assert.deepEqual(actual, baseline.dynamic.blog, file);
  }
});

test('shared footer keeps the exact approved Google then Apple badge sources and inline sizes', () => {
  const source = read('views/platform/partials/footer.ejs');
  const g = baseline.footer.google_src;
  const a = baseline.footer.apple_src;
  assert.ok(source.indexOf(g) >= 0 && source.indexOf(a) > source.indexOf(g));
  assert.ok(source.includes(`style="${baseline.footer.google_style}" alt="Google Play"`));
  assert.ok(source.includes(`alt="Download on the App Store" style="${baseline.footer.apple_style}"`));
  assert.doesNotMatch(source, /store-link|google-play-badge|app-store-badge|store-badges/);
});

test('generic Key Features and Academy-logo image fallbacks are absent', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'public/js/public-image-fallback.js')), false);
  assert.doesNotMatch(read('views/tenant/public/schools/view.ejs'), /img \|\| ['"]\/img\/feature/);
  assert.doesNotMatch(read('public/css/style.css'), /background-image:[^;]+academylogo\.(?:png|webp)/);
  assert.doesNotMatch(read('src/controllers/platform/publicSearchController.js'), /\/img\/feature\.(?:png|webp)/);
});

test('rotating center image keeps the exact approved unsqueezed markup and circular CSS', () => {
  const pages = [
    ['views/platform/public/index.ejs', '<img src="img/feature.png" alt="Center Icon" />'],
    ['views/platform/public/benefits.ejs', '<img alt="Classic Academy Modules" src="img/feature.png">'],
  ];
  for (const [file, expectedTag] of pages) {
    const src = read(file);
    const center = src.match(/<div class="orbit-center">\s*(<img[^>]*>)/);
    assert.ok(center, `${file}: rotating center image missing`);
    assert.equal(center[1], expectedTag, `${file}: rotating center image markup drifted`);
    assert.doesNotMatch(center[1], /\s(?:width|height|loading|decoding)=/i, `${file}: center image must not receive injected sizing/lazy attributes`);
    assert.match(src, /\.orbit-center\s*\{[\s\S]*?width:\s*clamp\(90px,\s*14vw,\s*150px\);[\s\S]*?height:\s*clamp\(90px,\s*14vw,\s*150px\);[\s\S]*?border-radius:\s*50%;/);
    assert.match(src, /\.orbit-center img\s*\{[\s\S]*?width:\s*100%;[\s\S]*?border-radius:\s*50%;/);
  }
});


test('shared footer normalizes the approved main-page spacing and responsive cascade on every marketing page', () => {
  const source = read('views/platform/partials/footer.ejs');
  assert.match(source, /margin:\s*2rem var\(--page-pad\);/);
  assert.match(source, /padding:\s*0;/);
  assert.match(source, /\.footer h4\s*\{[\s\S]*?margin:\s*0 0 1rem;/);
  assert.match(source, /\.footer ul\s*\{[\s\S]*?margin:\s*0;[\s\S]*?padding:\s*0;/);
  assert.match(source, /@media \(max-width:\s*600px\)[\s\S]*?\.footer[\s\S]*?backdrop-filter:\s*none !important;/);
  assert.match(source, /@media \(max-width:\s*480px\)[\s\S]*?\.footer h4[\s\S]*?font-size:\s*1\.15rem;/);
  for (const name of Object.keys(baseline.public_page_image_sources_excluding_shared_footer)) {
    const page = read(`views/platform/public/${name}`);
    assert.equal((page.match(/partials\/footer/g) || []).length, 1, `${name}: must use the canonical footer exactly once`);
  }
});

test('schedule CSP permits only the two approved external footer badge hosts in addition to existing image sources', () => {
  const booking = read('src/controllers/platform/bookingController.js');
  assert.match(booking, /"img-src": \["'self'", "data:", "https:\/\/res\.cloudinary\.com", "https:\/\/upload\.wikimedia\.org", "https:\/\/developer\.apple\.com"\]/);
});
