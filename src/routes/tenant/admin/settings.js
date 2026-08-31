const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/admin/settingsController");

router.get("/", ctrl.index);
router.post("/", ctrl.save);
router.post("/reset", ctrl.resetDefaults);
router.post("/test", ctrl.testConfiguration);

module.exports = router;
