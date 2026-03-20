const express = require("express");
const router = express.Router();

const ctrl = require("../../../controllers/tenant/admin/payrollController");

router.get("/", ctrl.index);
router.post("/", ctrl.createRun);
router.post("/bulk", ctrl.bulkAction);
router.post("/:id/update", ctrl.updateRun);
router.post("/:id/process", ctrl.processRun);
router.post("/:id/approve", ctrl.approveRun);
router.post("/:id/close", ctrl.closeRun);
router.post("/:id/delete", ctrl.deleteRun);

module.exports = router;