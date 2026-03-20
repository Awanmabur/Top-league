const express = require("express");
const router = express.Router();

const notificationsController = require("../../../controllers/tenant/parents/notificationsController");

router.get("/notifications", notificationsController.index);
router.post("/notifications/:id/read", notificationsController.markRead);
router.post("/notifications/read-all", notificationsController.markAllRead);

module.exports = router;