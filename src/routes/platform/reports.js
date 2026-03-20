const express = require("express");
const router = express.Router();
const reportsController = require("../../controllers/platform/reportsController");

router.get("/super-admin/reports", reportsController.reportsHome);
router.get("/super-admin/reports/tenants", reportsController.tenantReport);
router.get("/super-admin/reports/plans", reportsController.planReport);
router.get("/super-admin/reports/payments", reportsController.paymentReport);

module.exports = router;