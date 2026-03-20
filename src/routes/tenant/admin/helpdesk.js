const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/admin/helpdeskController");

router.get("/", ctrl.index);
router.post("/", ctrl.create);
router.post("/bulk", ctrl.bulkAction);
router.post("/:id/update", ctrl.update);
router.post("/:id/progress", ctrl.progress);
router.post("/:id/resolve", ctrl.resolve);
router.post("/:id/close", ctrl.close);
router.post("/:id/delete", ctrl.delete);

module.exports = router;