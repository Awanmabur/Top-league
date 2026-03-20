const express = require("express");
const router = express.Router();

const studentCtrl = require("../../../controllers/tenant/students/tudentController");
const tenantAuth = require("../../../middleware/tenant/requireTenantAuth");

// protect ALL student routes
router.use(tenantAuth("student"));

// dashboard
router.get("/dashboard", studentCtrl.dashboard);

module.exports = router;
