const express = require("express");
const router = express.Router();
const billingController = require("../../controllers/platform/billingController");

router.get("/super-admin/billing-subscriptions", billingController.billingSubscriptionsPage);
router.get("/super-admin/billing/payments/create", billingController.recordPaymentForm);
router.post("/super-admin/billing/payments/create", billingController.recordPayment);

module.exports = router;