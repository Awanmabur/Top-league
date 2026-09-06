"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

test("both login surfaces use clean copy and pill controls", () => {
  const platform = read("views/platform/auth/login.ejs");
  const tenant = read("views/tenant/auth/login.ejs");
  for (const source of [platform, tenant]) {
    assert.match(source, /\.input\{[\s\S]*?border-radius:999px/);
    assert.match(source, /\.btn\{[\s\S]*?border-radius:999px/);
    assert.match(source, /\.toggle\{[\s\S]*?border-radius:50%/);
    assert.match(source, /\/css\/classic-motion\.css/);
    assert.match(source, /\/js\/classic-motion\.js/);
  }
  assert.match(platform, /Welcome back to Classic Academy/);
  assert.match(platform, /Sign in to your account/);
  assert.match(platform, /Continue securely/);
  assert.match(tenant, /Welcome to <%= schoolName %>/);
  assert.match(tenant, /Sign in to your portal/);
  assert.match(tenant, /Continue to portal/);
});

test("tenant public home has four desktop stats, story gallery, and announcement preview modal", () => {
  const home = read("views/tenant/public/index.ejs");
  assert.match(home, /const statItems = \[\[stats\.students/);
  assert.doesNotMatch(home, /statItems[^\n]*\.filter/);
  assert.match(home, /gallery gallery-story/);
  assert.match(home, /figcaption/);
  assert.match(home, /data-announcement-open/);
  assert.match(home, /id="announcementModal"/);
  assert.match(home, /Read more/);
  const css = read("public/css/tenant-public-polish.css");
  assert.match(css, /\.stats\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)!important\}/);
  assert.match(css, /@media\(max-width:700px\)[\s\S]*?\.stats\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important\}/);
});

test("tenant public navigation and footer are shared, floating, rounded and four-column", () => {
  const nav = read("views/tenant/public/partials/site-nav.ejs");
  const footer = read("views/tenant/public/partials/site-footer.ejs");
  const css = read("public/css/tenant-public-polish.css");
  assert.match(nav, /class="tenant-site-nav topbar"/);
  assert.match(nav, /tenant-nav-menu/);
  assert.match(footer, /tenant-footer-grid/);
  assert.match(footer, /Admissions & Portal/);
  assert.match(footer, /tenant-socials/);
  assert.match(css, /\.tenant-site-nav\{[\s\S]*?position:sticky!important;[\s\S]*?border-radius:26px!important/);
  assert.match(css, /\.tenant-footer-grid\{[\s\S]*?grid-template-columns:1\.35fr \.8fr \.9fr 1fr/);
  assert.match(css, /\.tenant-footer-shell\{[\s\S]*?border-radius:32px/);
  const publicPages = [
    "views/tenant/public/index.ejs",
    "views/tenant/public/admissions/apply.ejs",
    "views/tenant/public/admissions/status.ejs",
    "views/tenant/public/scholarships/apply.ejs",
    "views/tenant/public/scholarships/index.ejs",
    "views/tenant/public/scholarships/status.ejs",
    "views/tenant/public/scholarships/view.ejs",
    "views/tenant/public/schools/school-profile.ejs",
    "views/tenant/public/schools/view.ejs",
  ];
  for (const file of publicPages) {
    const source = read(file);
    assert.match(source, /partials\/site-nav/);
    assert.match(source, /partials\/site-footer/);
    assert.match(source, /tenant-public-polish\.css/);
    assert.match(source, /classic-motion\.css/);
    assert.match(source, /tenant-public\.js/);
  }
});

test("tenant public controls and authenticated tenant workspace use rounded geometry", () => {
  const publicCss = read("public/css/tenant-public-polish.css");
  const portalCss = read("public/css/student-portal.css");
  const navCss = read("public/css/navbar.css");
  assert.match(publicCss, /body :is\(\.btn,a\.btn,button\.btn\)\{border-radius:999px!important/);
  assert.match(publicCss, /input:not\(\[type="checkbox"\]\)/);
  assert.match(portalCss, /body\[data-portal="tenant"\][\s\S]*?border-radius:999px!important/);
  assert.match(portalCss, /body\[data-portal="tenant"\][\s\S]*?border-radius:18px!important/);
  assert.match(navCss, /@media \(min-width:1101px\)[\s\S]*?body\[data-portal="tenant"\] \.sidebar[\s\S]*?border-radius:28px/);
});

test("marketing and tenant experiences load progressive motion without touching orbit geometry", () => {
  const marketingDir = path.join(ROOT, "views/platform/public");
  const marketing = fs.readdirSync(marketingDir).filter((x) => x.endsWith(".ejs"));
  assert.equal(marketing.length, 25);
  for (const name of marketing) {
    const source = fs.readFileSync(path.join(marketingDir, name), "utf8");
    assert.match(source, /\/css\/classic-motion\.css/, `${name} missing motion CSS`);
    assert.match(source, /\/js\/classic-motion\.js/, `${name} missing motion JS`);
  }
  const motion = read("public/js/classic-motion.js");
  assert.match(motion, /protectedMotionZone/);
  assert.match(motion, /\.orbit-ring,\.orbit-center,\.orbit-section,\.orbit-wrapper/);
  assert.match(motion, /\.filter\(\(el\) => !protectedMotionZone\(el\)\)/);
  assert.match(motion, /IntersectionObserver/);
  assert.match(motion, /prefers-reduced-motion/);
  assert.match(read("public/js/tenant-workspace-motion.js"), /ca-tenant-motion/);
  assert.match(read("public/css/tenant-controls.css"), /body\[data-portal="tenant"\]/);
  assert.match(read("public/css/classic-motion.css"), /ca-route-progress/);
});
