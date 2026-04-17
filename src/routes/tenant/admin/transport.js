const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/admin/transportController");

router.get("/", ctrl.index);
router.post("/", ctrl.create);
router.post("/:id", ctrl.update);
router.post("/:id/delete", ctrl.remove);

module.exports = router;
