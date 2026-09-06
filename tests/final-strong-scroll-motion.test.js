"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

test("marketing and tenant public motion has strong directional, staggered and depth scroll effects", () => {
  const js = read("public/js/classic-motion.js");
  const css = read("public/css/classic-motion.css");
  assert.match(js, /ca-scroll-progress/);
  assert.match(js, /ca-motion-from-left/);
  assert.match(js, /ca-motion-from-right/);
  assert.match(js, /ca-motion-scale/);
  assert.match(js, /ca-motion-scroll-float/);
  assert.match(js, /requestAnimationFrame/);
  assert.match(js, /IntersectionObserver/);
  assert.match(css, /translate3d\(-38px,12px,0\) scale\(\.99\)/);
  assert.match(css, /blur\(5px\)/);
  assert.match(css, /ca-motion-delay-8/);
  assert.match(css, /animation-timeline:view\(\)/);
});

test("strong motion never targets circular orbit geometry", () => {
  const js = read("public/js/classic-motion.js");
  assert.match(js, /\.orbit-ring,\.orbit-center,\.orbit-section,\.orbit-wrapper/);
  assert.match(js, /protectedMotionZone/);
  assert.match(js, /\.filter\(\(el\) => !protectedMotionZone\(el\)\)/);
  assert.doesNotMatch(js, /querySelectorAll\([^\n]*orbit-feature/);
});

test("tenant workspace gets matching strong staggered scroll animation", () => {
  const js = read("public/js/tenant-workspace-motion.js");
  const css = read("public/css/tenant-controls.css");
  assert.match(js, /ca-tenant-scroll-progress/);
  assert.match(js, /ca-tenant-left/);
  assert.match(js, /ca-tenant-right/);
  assert.match(js, /ca-tenant-scale/);
  assert.match(js, /requestAnimationFrame/);
  assert.match(css, /translate3d\(-38px,12px,0\) scale\(\.99\)/);
  assert.match(css, /ca-tenant-delay-8/);
});

test("all strong motion respects reduced-motion accessibility", () => {
  assert.match(read("public/js/classic-motion.js"), /prefers-reduced-motion: reduce/);
  assert.match(read("public/js/tenant-workspace-motion.js"), /prefers-reduced-motion: reduce/);
  assert.match(read("public/css/classic-motion.css"), /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(read("public/css/tenant-controls.css"), /@media\(prefers-reduced-motion:reduce\)/);
});
