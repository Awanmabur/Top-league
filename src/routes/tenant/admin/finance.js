const express = require("express");
const router = express.Router();

const ctrl = require("../../../controllers/tenant/admin/financeController");

router.get("/", ctrl.index);

module.exports = router;