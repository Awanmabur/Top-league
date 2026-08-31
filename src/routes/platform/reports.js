const express = require("express");
const router = express.Router();
const reportsController = require("../../controllers/platform/reportsController");
const { platformRequire } = require("../../middleware/platform/guards");

router.get("/super-admin/reports", platformRequire("reports.view"), reportsController.reportsHome);
router.get("/super-admin/reports/tenants", platformRequire("reports.view"), reportsController.tenantReport);
router.get("/super-admin/reports/plans", platformRequire("reports.view"), reportsController.planReport);
router.get("/super-admin/reports/payments", platformRequire("reports.view"), reportsController.paymentReport);
router.get("/super-admin/reports/tenants.csv", platformRequire("reports.view"), reportsController.exportTenantReport);
router.get("/super-admin/reports/plans.csv", platformRequire("reports.view"), reportsController.exportPlanReport);
router.get("/super-admin/reports/payments.csv", platformRequire("reports.view"), reportsController.exportPaymentReport);

module.exports = router;
