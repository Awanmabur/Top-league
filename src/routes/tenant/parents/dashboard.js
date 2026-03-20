const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/parents/dashboardController");

router.get("/dashboard", ctrl.dashboard);

module.exports = router;
