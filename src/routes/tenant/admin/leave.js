const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/admin/leaveController");

router.get("/", ctrl.index);
router.post("/", ctrl.create);
router.post("/bulk", ctrl.bulkAction);
router.post("/:id/update", ctrl.update);
router.post("/:id/approve", ctrl.approve);
router.post("/:id/reject", ctrl.reject);
router.post("/:id/cancel", ctrl.cancel);
router.post("/:id/delete", ctrl.delete);

module.exports = router;