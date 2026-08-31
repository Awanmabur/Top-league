const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/staff/notificationsController");

router.get("/notifications", ctrl.list);
router.post("/notifications/:id/read", ctrl.read);
router.post("/notifications/read-all", ctrl.markAllRead);
router.post("/notifications/preferences", ctrl.savePreferences);

module.exports = router;
