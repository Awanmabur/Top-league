"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("public discovery exposes dynamic school sitemap, OAI-SearchBot policy and IndexNow", () => {
  const pages = read("src/routes/platform/pages.js");
  assert.match(pages, /Tenant\.find\(/);
  assert.match(pages, /\/schools\/\$\{encodeURIComponent/);
  assert.match(pages, /OAI-SearchBot/);
  assert.match(pages, /User-agent: GPTBot/);
  assert.match(pages, /\/llms\.txt/);
  assert.match(pages, /\/indexnow-key\.txt/);
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["check:seo"], "node scripts/check-seo-discovery.js");
  assert.equal(pkg.scripts["seo:indexnow"], "node scripts/submit-indexnow.js");
});

test("tenant public home owns tenant canonical, social metadata and EducationalOrganization schema", () => {
  const view = read("views/tenant/public/index.ejs");
  assert.match(view, /publicCanonicalUrl/);
  assert.match(view, /max-image-preview:large/);
  assert.match(view, /og:site_name/);
  assert.match(view, /twitter:card/);
  assert.match(view, /EducationalOrganization/);
  assert.match(view, /"@type":"WebSite"/);
  assert.match(view, /structuredDataEnabled/);
});

test("platform school profiles keep platform canonicals while tenant custom canonicals remain tenant-site concerns", () => {
  const profile = read("views/platform/public/school-profile.ejs");
  assert.match(profile, /const defaultCanonical = .*\/schools\/\$\{tenant\.code\}/);
  assert.match(profile, /const seoCanonical = defaultCanonical/);
  assert.match(profile, /BreadcrumbList/);
  assert.match(profile, /max-image-preview:large/);
});

test("noindex middleware protects auth, status and application utility surfaces", () => {
  assert.match(read("src/middleware/noIndex.js"), /X-Robots-Tag/);
  assert.match(read("src/routes/platform/auth.js"), /reset-password[\s\S]*noIndex/);
  assert.match(read("src/routes/tenant/tenant/index.js"), /admissions\/status[\s\S]*noIndex/);
  assert.match(read("src/routes/tenant/public/scholarships.js"), /:\/id\/apply|\/:id\/apply/);
});

test("motion follows Chariot reference proportions and protects the circular orbit", () => {
  const js = read("public/js/classic-motion.js");
  const css = read("public/css/classic-motion.css");
  assert.match(js, /protectedMotionZone/);
  assert.match(js, /\.orbit-ring,\.orbit-center,\.orbit-section,\.orbit-wrapper/);
  assert.match(js, /rootMargin: "0px 0px -7% 0px"/);
  assert.match(css, /translate3d\(-38px,12px,0\) scale\(\.99\)/);
  assert.match(css, /translate3d\(0,30px,0\) scale\(\.988\)/);
  assert.match(css, /blur\(5px\)/);
  assert.match(css, /--ca-motion-med:620ms/);
  assert.match(css, /--ca-motion-slow:880ms/);
  assert.match(css, /animation-timeline:view\(\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test("IndexNow sanitizes same-host URLs and is bounded", async () => {
  const old = process.env.INDEXNOW_KEY;
  process.env.INDEXNOW_KEY = "classicacademy2026";
  delete require.cache[require.resolve("../src/services/indexNowService")];
  const svc = require("../src/services/indexNowService");
  let payload;
  const result = await svc.submitIndexNow({
    siteUrl: "https://www.classicacademy.app",
    urls: ["https://www.classicacademy.app/", "https://evil.example/", "https://www.classicacademy.app/schools#top"],
    fetchImpl: async (_url, options) => { payload = JSON.parse(options.body); return { ok: true, status: 200 }; },
  });
  if (old === undefined) delete process.env.INDEXNOW_KEY; else process.env.INDEXNOW_KEY = old;
  assert.equal(result.ok, true);
  assert.equal(result.submitted, 2);
  assert.equal(payload.host, "www.classicacademy.app");
  assert.deepEqual(payload.urlList, ["https://www.classicacademy.app/", "https://www.classicacademy.app/schools"]);
});
