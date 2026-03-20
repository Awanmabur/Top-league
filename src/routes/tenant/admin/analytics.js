const express = require("express");
const router = express.Router();

const ctrl = require("../../../controllers/tenant/admin/analyticsController");

router.get("/", ctrl.analyticsPage);
router.get("/export", ctrl.exportAnalyticsCsv);

module.exports = router;