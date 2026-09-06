#!/usr/bin/env node
"use strict";
const { submitIndexNow } = require("../src/services/indexNowService");

const siteUrl = String(process.env.PUBLIC_SITE_URL || process.env.PLATFORM_SITE_URL || "").trim().replace(/\/+$/, "");
if (!siteUrl) {
  console.error("PUBLIC_SITE_URL or PLATFORM_SITE_URL is required.");
  process.exitCode = 1;
  return;
}

const paths = [
  "/", "/about", "/features", "/services", "/benefits", "/contact", "/schedule",
  "/plan", "/blog", "/careers", "/faq", "/admissions", "/schools", "/security",
  "/integrations", "/resources", "/docs", "/privacy", "/terms", "/sitemap.xml",
];

(async () => {
  const result = await submitIndexNow({ siteUrl, urls: paths.map((path) => `${siteUrl}${path}`) });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok && !result.skipped) process.exitCode = 1;
})();
