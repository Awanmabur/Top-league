const express = require("express");
const router = express.Router();
const billingController = require("../../controllers/platform/billingController");
const { platformRequire } = require("../../middleware/platform/guards");

router.get("/super-admin/billing-subscriptions", platformRequire("billing.view"), billingController.billingSubscriptionsPage);
router.get("/super-admin/billing/payments/create", platformRequire("billing.manage"), billingController.recordPaymentForm);
router.post("/super-admin/billing/payments/create", platformRequire("billing.manage"), billingController.recordPayment);

module.exports = router;
