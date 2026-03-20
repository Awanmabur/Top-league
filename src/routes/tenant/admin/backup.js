const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/admin/backupController");

router.get("/", ctrl.index);
router.post("/", ctrl.create);
router.post("/bulk", ctrl.bulkAction);
router.post("/:id/run", ctrl.run);
router.post("/:id/archive", ctrl.archive);
router.post("/:id/delete", ctrl.delete);

module.exports = router;