const express = require("express");
const router = express.Router();
const financeController = require("../../../controllers/tenant/students/financeController");

router.get("/finance", financeController.finance);
router.get("/finance/receipts/:id", financeController.receipt);

module.exports = router;