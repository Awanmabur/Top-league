const express = require("express");
const router = express.Router();
const notificationsController = require("../../../controllers/tenant/students/notificationsController");

router.get("/notifications", notificationsController.notifications);
router.post("/notifications/:id/read", notificationsController.markNotificationRead);
router.post("/notifications/read-all", notificationsController.markAllRead);
router.post("/notifications/preferences", notificationsController.savePreferences);
router.post("/announcements/:id/ack", notificationsController.acknowledgeAnnouncement);

module.exports = router;
