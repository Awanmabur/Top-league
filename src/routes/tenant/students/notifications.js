const express = require("express");
const router = express.Router();
const notificationsController = require("../../../controllers/tenant/students/notificationsController");

router.get("/notifications", notificationsController.notifications);

module.exports = router;