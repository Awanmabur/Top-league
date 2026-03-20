const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/staff/leaveController");

router.get("/leave", ctrl.list);
router.get("/leave/new", ctrl.newForm);
router.post("/leave", ctrl.create);

module.exports = router;
