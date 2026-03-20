const express = require("express");
const router = express.Router();
const dashboardController = require("../../controllers/platform/dashboardController");

router.get("/super-admin/dashboard", dashboardController.dashboardPage);

module.exports = router;