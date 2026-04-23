const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/admin/auditlogsController");

router.get("/", ctrl.index);
router.get("/export.csv", ctrl.exportCsv);
router.post("/reviewed", ctrl.markReviewed);

module.exports = router;