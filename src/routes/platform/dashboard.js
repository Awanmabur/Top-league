const express = require("express");
const router = express.Router();
const dashboardController = require("../../controllers/platform/dashboardController");
const { platformRequire } = require("../../middleware/platform/guards");

router.get("/super-admin/dashboard", platformRequire("dashboard.view"), dashboardController.dashboardPage);

module.exports = router;
