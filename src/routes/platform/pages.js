const express = require("express");
const router = express.Router();

const resolveTenantByCode = require("../../middleware/tenant/resolveTenantByCode");
const { publicInquiryLimiter, publicReviewLimiter } = require("../../middleware/tenant/rateLimiters");

const ctrl = require("../../controllers/platform/schoolsPublicController");
const publicSearchController = require("../../controllers/platform/publicSearchController");

function getSiteUrl(req) {
  const configured = process.env.PUBLIC_SITE_URL || process.env.PLATFORM_SITE_URL || "";
  if (configured) return configured.replace(/\/+$/, "");

  const proto = req.protocol || (req.secure ? "https" : "http");
  const host = (req.get && req.get("host")) || req.headers.host || "localhost";
  return `${proto}://${host}`;
}

router.get("/", ctrl.landing);
router.get("/about", (req, res) => res.render("platform/public/about"));
router.get("/features", (req, res) => res.render("platform/public/features"));
router.get("/services", (req, res) => res.render("platform/public/services"));
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
  res.type("text/plain").send(
    ["User-agent: *", "Allow: /", `Sitemap: ${getSiteUrl(req)}/sitemap.xml`, ""].join("\n"),
  );
});

router.get("/sitemap.xml", (req, res) => {
  const base = getSiteUrl(req);
  const paths = [
    "/", "/about", "/features", "/services", "/contact", "/schedule", "/plan",
    "/blog", "/careers", "/faq", "/privacy", "/terms", "/admissions", "/schools",
    "/security", "/integrations", "/resources", "/docs", "/status",
  ];
  const urls = paths
    .map((p) => `  <url><loc>${base}${p}</loc></url>`)
    .join("\n");
  res.type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`,
  );
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
