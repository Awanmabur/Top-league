const express = require("express");
const router = express.Router();

const ctrl = require("../../../controllers/tenant/admin/paymentsController");

router.get("/", ctrl.index);
router.get("/export.csv", ctrl.exportCsv);
router.get("/:id/receipt", ctrl.receipt);
router.post("/", ctrl.create);
router.post("/bulk", ctrl.bulkAction);
router.post("/:id/update", ctrl.update);
router.post("/:id/complete", ctrl.complete);
router.post("/:id/void", ctrl.void);
router.post("/:id/refund", ctrl.refund);
router.post("/:id/delete", ctrl.delete);

module.exports = router;