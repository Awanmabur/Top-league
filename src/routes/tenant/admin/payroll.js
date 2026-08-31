const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/admin/payrollController");

router.get("/", ctrl.index);
router.get("/export.csv", ctrl.exportCsv);
router.post("/", ctrl.createRun);
router.post("/bulk", ctrl.bulkAction);
router.post("/:id/update", ctrl.updateRun);
router.post("/:id/process", ctrl.processRun);
router.post("/:id/approve", ctrl.approveRun);
router.post("/:id/pay", ctrl.payRun);
router.post("/:id/close", ctrl.closeRun);
router.post("/:id/delete", ctrl.deleteRun);
router.post("/:id/items/:itemId/update", ctrl.updateItem);
router.post("/:id/items/:itemId/hold", ctrl.holdItem);
router.post("/:id/items/:itemId/release", ctrl.releaseItem);
router.post("/:id/items/:itemId/pay", ctrl.payItem);

module.exports = router;
