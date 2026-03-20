const express = require("express");
const router = express.Router();

const tenantCtrl = require("../../../controllers/tenant/tenant/tenantController");

// Public (no login required)
router.get("/", tenantCtrl.index);

module.exports = router;
