// src/routes/tenant/admin/staff.js
const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/admin/staffController");

router.get("/", ctrl.index);
router.post("/", ctrl.create);
router.post("/bulk", ctrl.bulkAction);
router.post("/:id/update", ctrl.update);
router.post("/:id/status", ctrl.updateStatus);
router.post("/:id/delete", ctrl.delete);

module.exports = router;