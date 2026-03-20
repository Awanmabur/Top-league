const express = require("express");
const router = express.Router();

const ctrl = require("../../../controllers/tenant/admin/promotionsController");

router.get("/", ctrl.index);
router.post("/apply", ctrl.applyBulk);

module.exports = router;