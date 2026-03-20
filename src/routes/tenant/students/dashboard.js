const express = require("express");
const router = express.Router();
const dashboardController = require("../../../controllers/tenant/students/dashboardController");

router.get("/dashboard", dashboardController.dashboard);

module.exports = router;