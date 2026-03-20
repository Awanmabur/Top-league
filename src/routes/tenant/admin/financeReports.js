const express = require("express");
const router = express.Router();

const ctrl = require("../../../controllers/tenant/admin/financeReportsController");

router.get("/", ctrl.index);

module.exports = router;