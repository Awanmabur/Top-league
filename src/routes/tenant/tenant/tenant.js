const express = require("express");
const router = express.Router();

const tenantCtrl = require("../../../controllers/tenant/tenant/tenantController");

// Public metadata and school website (no login required)
router.get("/robots.txt", tenantCtrl.robots);
router.get("/sitemap.xml", tenantCtrl.sitemap);
router.get("/llms.txt", tenantCtrl.llms);
router.get("/indexnow-key.txt", tenantCtrl.indexNowKey);
router.get("/", tenantCtrl.index);

module.exports = router;
