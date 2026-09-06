#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "views", "platform", "public");
const BASE = "https://www.classicacademy.app";
const failures = [];
const read = (file) => fs.readFileSync(file, "utf8");
const has = (text, re) => re.test(text);

for (const name of fs.readdirSync(PUBLIC).filter((name) => name.endsWith(".ejs")).sort()) {
  if (["404.ejs", "500.ejs", "school-profile.ejs"].includes(name)) continue;
  const source = read(path.join(PUBLIC, name));
  const head = source.split("</head>", 1)[0];
  const robotMatch = head.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)/i)
    || head.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']robots["']/i);
  const robots = String(robotMatch?.[1] || "").toLowerCase();
  if (!/<title>[\s\S]*?<\/title>/i.test(head)) failures.push(`${name}: missing title`);
  if (!/<meta[^>]+name=["']description["']/i.test(head)) failures.push(`${name}: missing description`);
  if (!robotMatch) failures.push(`${name}: missing robots directive`);
  if (robots.includes("noindex")) continue;

  const canonicalOk = /<link[^>]+rel=["']canonical["'][^>]+href=["']https:\/\/www\.classicacademy\.app/i.test(head)
    || /<link[^>]+href=["']https:\/\/www\.classicacademy\.app[^"']*["'][^>]+rel=["']canonical["']/i.test(head);
  const ogUrlOk = /<meta[^>]+property=["']og:url["'][^>]+content=["']https:\/\/www\.classicacademy\.app/i.test(head)
    || /<meta[^>]+content=["']https:\/\/www\.classicacademy\.app[^"']*["'][^>]+property=["']og:url["']/i.test(head);
  const ogImageOk = /<meta[^>]+property=["']og:image["'][^>]+content=["']https:\/\//i.test(head)
    || /<meta[^>]+content=["']https:\/\/[^"']+["'][^>]+property=["']og:image["']/i.test(head);
  if (!canonicalOk) failures.push(`${name}: missing absolute canonical`);
  if (!/<meta[^>]+property=["']og:title["']/i.test(head)) failures.push(`${name}: missing og:title`);
  if (!ogUrlOk) failures.push(`${name}: missing absolute og:url`);
  if (!ogImageOk) failures.push(`${name}: missing absolute og:image`);
  if (!/<meta[^>]+name=["']twitter:card["']/i.test(head)) failures.push(`${name}: missing twitter:card`);
}

const pages = read(path.join(ROOT, "src", "routes", "platform", "pages.js"));
for (const token of ["OAI-SearchBot", "GPTBot", "/sitemap.xml", "/llms.txt", "/indexnow-key.txt", "/benefits"]) {
  if (!pages.includes(token)) failures.push(`platform discovery route missing ${token}`);
}
if (!/"User-agent: GPTBot"[\s\S]*?"Disallow: \/"/.test(pages)) failures.push("GPTBot training opt-out missing");
if (!/Tenant\.find\([\s\S]*?\/schools\/\$\{encodeURIComponent/.test(pages)) failures.push("platform sitemap does not expand school profile URLs");
for (const utility of ["/search", "/share", "/status"]) {
  const sitemapBlock = (pages.match(/const staticPaths = \[[\s\S]*?\];/) || [""])[0];
  if (sitemapBlock.includes(`"${utility}"`)) failures.push(`noindex utility leaked into sitemap: ${utility}`);
}

const tenantHome = read(path.join(ROOT, "views", "tenant", "public", "index.ejs"));
for (const token of ["EducationalOrganization", "WebSite", "publicCanonicalUrl", "og:site_name", "twitter:card", "max-image-preview:large"]) {
  if (!tenantHome.includes(token)) failures.push(`tenant home SEO missing ${token}`);
}
const tenantCtrl = read(path.join(ROOT, "src", "controllers", "tenant", "tenant", "tenantController.js"));
for (const token of ["OAI-SearchBot", "GPTBot", "scholarshipService.publicScholarshipFilter", "indexNowKey"]) {
  if (!tenantCtrl.includes(token)) failures.push(`tenant discovery source missing ${token}`);
}

const motionJs = read(path.join(ROOT, "public", "js", "classic-motion.js"));
const motionCss = read(path.join(ROOT, "public", "css", "classic-motion.css"));
for (const token of ["protectedMotionZone", ".orbit-ring,.orbit-center,.orbit-section,.orbit-wrapper", "ca-motion-from-left", "ca-motion-from-right", "ca-motion-scale", "ca-motion-scroll-float"]) {
  if (!motionJs.includes(token)) failures.push(`motion contract missing ${token}`);
}
for (const token of ["translate3d(-38px,12px,0) scale(.99)", "blur(5px)", "animation-timeline:view()", "cubic-bezier(.2,.78,.24,1)"]) {
  if (!motionCss.includes(token)) failures.push(`Chariot-tuned motion CSS missing ${token}`);
}

const indexNow = read(path.join(ROOT, "src", "services", "indexNowService.js"));
if (!indexNow.includes("api.indexnow.org/indexnow") || !indexNow.includes("keyLocation")) failures.push("IndexNow implementation incomplete");

if (failures.length) {
  console.error(`SEO/discovery gate: FAIL (${failures.length})`);
  for (const issue of failures) console.error(`- ${issue}`);
  process.exit(1);
}
console.log("SEO/discovery gate: PASS (marketing metadata, tenant schema, sitemaps, AI/search crawlers, IndexNow, Chariot-tuned motion)");
