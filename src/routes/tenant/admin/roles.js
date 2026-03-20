const express = require("express");
const router = express.Router();

const ctrl = require("../../../controllers/tenant/admin/rolesController");

router.get("/", ctrl.index);
router.post("/", ctrl.create);
router.post("/bulk", ctrl.bulkAction);
router.post("/:id/update", ctrl.update);
router.post("/:id/activate", ctrl.activate);
router.post("/:id/deactivate", ctrl.deactivate);
router.post("/:id/delete", ctrl.delete);

module.exports = router;