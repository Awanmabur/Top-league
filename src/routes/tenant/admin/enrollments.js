const express = require("express");
const router = express.Router();

const ctrl = require("../../../controllers/tenant/admin/enrollmentsController");

router.get("/", ctrl.index);
router.get("/export.csv", ctrl.exportCsv);

router.post("/", ctrl.create);
router.post("/bulk", ctrl.bulk);
router.post("/:id", ctrl.update);
router.post("/:id/delete", ctrl.softDelete);

module.exports = router;