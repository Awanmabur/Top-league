const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/admin/api-integrationsController");

router.get("/", ctrl.index);
router.post("/", ctrl.save);
router.post("/bulk", ctrl.bulkAction);
router.post("/:id/toggle", ctrl.toggle);
router.post("/:id/test", ctrl.test);
router.post("/:id/delete", ctrl.delete);

module.exports = router;