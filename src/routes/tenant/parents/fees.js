const express = require("express");
const router = express.Router();

const feesController = require("../../../controllers/tenant/parents/feesController");

router.get("/fees", feesController.index);
router.get("/fees/receipts/:id", feesController.receipt);

module.exports = router;