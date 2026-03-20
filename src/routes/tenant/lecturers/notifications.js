const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/lecturers/notificationsController");

// Notifications center
router.get("/notifications", ctrl.list);
router.post("/notifications/:id/read", ctrl.read);

module.exports = router;
