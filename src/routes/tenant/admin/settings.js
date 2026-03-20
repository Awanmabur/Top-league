const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/admin/settingsController");

router.get("/", ctrl.index);
router.post("/", ctrl.save);

module.exports = router;