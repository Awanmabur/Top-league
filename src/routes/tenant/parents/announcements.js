const express = require("express");
const router = express.Router();
const announcementsController = require("../../../controllers/tenant/parents/announcementsController");

router.get("/announcements", announcementsController.index);
router.post("/announcements/:id/ack", announcementsController.acknowledge);

module.exports = router;
