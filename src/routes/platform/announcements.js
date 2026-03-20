const express = require("express");
const router = express.Router();
const announcementsController = require("../../controllers/platform/announcementsController");

router.get("/super-admin/announcements", announcementsController.listAnnouncements);
router.get("/super-admin/announcements/create", announcementsController.createAnnouncementForm);
router.post("/super-admin/announcements/create", announcementsController.createAnnouncement);

router.get("/super-admin/announcements/:id", announcementsController.showAnnouncement);
router.post("/super-admin/announcements/:id/publish", announcementsController.publishAnnouncement);
router.post("/super-admin/announcements/:id/delete", announcementsController.deleteAnnouncement);

module.exports = router;