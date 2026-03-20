const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/staff/payrollController");

router.get("/payroll", ctrl.list);

module.exports = router;
