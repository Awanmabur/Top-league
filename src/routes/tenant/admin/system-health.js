const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/admin/system-healthController");

router.get("/", ctrl.index);
router.post("/", ctrl.create);
router.post("/bulk", ctrl.bulkAction);
router.post("/:id/healthy", ctrl.markHealthy);
router.post("/:id/maintenance", ctrl.markMaintenance);

module.exports = router;