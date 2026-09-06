const express = require("express");
const router = express.Router();

const resolveTenantByCode = require("../../middleware/tenant/resolveTenantByCode");
const { publicInquiryLimiter, publicReviewLimiter } = require("../../middleware/tenant/rateLimiters");

const ctrl = require("../../controllers/platform/schoolsPublicController");
const publicSearchController = require("../../controllers/platform/publicSearchController");
const { platformConnection } = require("../../config/db");
const Tenant = require("../../models/platform/Tenant")(platformConnection);
const { addOperationalTenantCondition } = require("../../services/platformPublicDirectoryService");
const { configuredKey } = require("../../services/indexNowService");

function cachePublicPage(req, res, next) {
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
  next();
}

function cachePublicMetadata(req, res, next) {
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600");
  next();
}

function getSiteUrl(req) {
  const configured = process.env.PUBLIC_SITE_URL || process.env.PLATFORM_SITE_URL || "";
  if (configured) return configured.replace(/\/+$/, "");

  if (process.env.NODE_ENV === "production") {
    throw new Error("PUBLIC_SITE_URL or PLATFORM_SITE_URL is required for public metadata in production.");
  }
  const hostname = String(req.hostname || "localhost").trim().toLowerCase();
  if (!/^(?:localhost|127\.0\.0\.1|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/.test(hostname)) return "http://localhost";
  const localPort = Number(req.socket?.localPort || process.env.PORT || 0);
  const port = localPort > 0 && localPort <= 65535 ? `:${localPort}` : "";
  return `${req.protocol === "https" ? "https" : "http"}://${hostname}${port}`;
}

router.use(
  ["/about", "/features", "/services", "/benefits", "/contact", "/schedule", "/plan", "/blog", "/careers", "/faq", "/privacy", "/terms", "/admissions", "/share", "/security", "/integrations", "/resources", "/docs", "/status"],
  cachePublicPage,
);
router.use(["/robots.txt", "/sitemap.xml", "/llms.txt", "/indexnow-key.txt"], cachePublicMetadata);

router.get("/", ctrl.landing);
router.get("/about", (req, res) => res.render("platform/public/about"));
router.get("/features", (req, res) => res.render("platform/public/features"));
router.get("/services", (req, res) => res.render("platform/public/services"));
router.get("/benefits", (req, res) => res.render("platform/public/benefits"));
// router.get("/schools", (req, res) => res.render("platform/public/schools"));
// router.get("/search", (req, res) => res.render("platform/public/search"));
router.get("/contact", (req, res) => res.render("platform/public/contact"));
router.get("/schedule", (req, res) => res.render("platform/public/schedule"));
router.get("/plan", (req, res) => res.render("platform/public/plan"));
router.get("/blog", (req, res) => res.render("platform/public/blog"));
router.get("/careers", (req, res) => res.render("platform/public/careers"));
router.get("/faq", (req, res) => res.render("platform/public/faq"));
router.get("/privacy", (req, res) => res.render("platform/public/privacy"));
router.get("/terms", (req, res) => res.render("platform/public/terms"));
router.get("/admissions", (req, res) => res.render("platform/public/admissions"));
router.get("/share", (req, res) => res.render("platform/public/share"));

router.get("/robots.txt", (req, res) => {
  const sitemap = `${getSiteUrl(req)}/sitemap.xml`;
  const privatePaths = [
    "/admin/", "/student/", "/parent/", "/staff/", "/invite", "/api/",
  ];
  const group = (agent, allowRoot = true) => [
    `User-agent: ${agent}`,
    ...(allowRoot ? ["Allow: /"] : []),
    ...privatePaths.map((path) => `Disallow: ${path}`),
  ];
  const lines = [
    ...group("*"),
    "",
    // Search discovery is separate from model-training access. OAI-SearchBot is
    // explicitly allowed for ChatGPT search while GPTBot remains opted out.
    ...group("OAI-SearchBot"),
    "",
    "User-agent: GPTBot",
    "Disallow: /",
    "",
    `Sitemap: ${sitemap}`,
    "",
  ];
  res.type("text/plain").send(lines.join("\n"));
});

function xmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

router.get("/sitemap.xml", async (req, res) => {
  const base = getSiteUrl(req);
  const staticPaths = [
    "/", "/about", "/features", "/services", "/benefits", "/contact", "/schedule",
    "/plan", "/blog", "/careers", "/faq", "/privacy", "/terms", "/admissions",
    "/schools", "/security", "/integrations", "/resources", "/docs",
  ];

  const entries = staticPaths.map((path) => ({ loc: `${base}${path}`, lastmod: null }));
  try {
    const tenants = await Tenant.find(addOperationalTenantCondition({
      isDeleted: { $ne: true },
      $or: [
        { "settings.profile.enabled": { $ne: false }, "settings.profile.seo.indexable": { $ne: false } },
        { "settings.academics.schoolUnits": { $elemMatch: { isActive: { $ne: false }, "profile.enabled": { $ne: false } } } },
      ],
    }))
      .select("code updatedAt settings.profile.enabled settings.profile.seo.indexable")
      .sort({ updatedAt: -1 })
      .limit(45000)
      .lean();

    for (const tenant of tenants) {
      if (!tenant?.code) continue;
      entries.push({
        loc: `${base}/schools/${encodeURIComponent(String(tenant.code))}`,
        lastmod: tenant.updatedAt instanceof Date ? tenant.updatedAt.toISOString() : (tenant.updatedAt ? new Date(tenant.updatedAt).toISOString() : null),
      });
    }
  } catch (error) {
    // Keep the static sitemap available during a transient database outage.
    console.error("public sitemap tenant expansion failed:", error?.message || error);
  }

  const urls = entries.map(({ loc, lastmod }) => {
    const last = lastmod ? `<lastmod>${xmlEscape(lastmod)}</lastmod>` : "";
    return `  <url><loc>${xmlEscape(loc)}</loc>${last}</url>`;
  }).join("\n");

  res.type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`,
  );
});

router.get("/llms.txt", (req, res) => {
  const base = getSiteUrl(req);
  res.type("text/plain").send([
    "# Classic Academy",
    "",
    "> Classic Academy is a school-management and admissions platform connecting schools, students, parents and staff.",
    "",
    "## Key public pages",
    `- Home: ${base}/`,
    `- Features: ${base}/features`,
    `- Services: ${base}/services`,
    `- Benefits: ${base}/benefits`,
    `- Admissions: ${base}/admissions`,
    `- School directory: ${base}/schools`,
    `- Pricing: ${base}/plan`,
    `- Security: ${base}/security`,
    `- Integrations: ${base}/integrations`,
    `- Documentation: ${base}/docs`,
    `- Sitemap: ${base}/sitemap.xml`,
    "",
    "Public school profiles are available under /schools/{school-code}.",
    "Authenticated dashboards, application-status lookups, and private student/staff data are not public documentation.",
    "",
  ].join("\n"));
});

router.get("/indexnow-key.txt", (req, res) => {
  const key = configuredKey();
  if (!key) return res.status(404).type("text/plain").send("Not configured");
  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.type("text/plain").send(key);
});

router.get("/security", (req, res) => res.render("platform/public/security"));
router.get("/pricing", (req, res) => res.redirect(301, "/plan"));
router.get("/integrations", (req, res) => res.render("platform/public/integrations"));
router.get("/resources", (req, res) => res.render("platform/public/resources"));
router.get("/docs", (req, res) => res.render("platform/public/docs"));
router.get("/support", (req, res) => res.redirect(301, "/contact"));
router.get("/status", (req, res) => res.render("platform/public/status"));

router.get("/schools", ctrl.list);
router.get("/schools/:code/apply", resolveTenantByCode, ctrl.applyRedirect);
router.get("/schools/:code", resolveTenantByCode, ctrl.page);
router.post("/schools/:code/inquiry", publicInquiryLimiter, resolveTenantByCode, ctrl.inquiry);
router.post("/schools/:code/reviews", publicReviewLimiter, resolveTenantByCode, ctrl.review);

router.get("/search", publicSearchController.page);

router.use((req, res) => res.status(404).render("platform/public/404"));

module.exports = router;
