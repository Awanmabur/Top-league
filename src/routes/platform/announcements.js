const express = require("express");
const router = express.Router();
const announcementsController = require("../../controllers/platform/announcementsController");
const { platformRequire } = require("../../middleware/platform/guards");

router.get("/super-admin/announcements", platformRequire("announcements.view"), announcementsController.listAnnouncements);
router.get("/super-admin/announcements/create", platformRequire("announcements.manage"), announcementsController.createAnnouncementForm);
router.post("/super-admin/announcements/create", platformRequire("announcements.manage"), announcementsController.createAnnouncement);

router.get("/super-admin/announcements/:id", platformRequire("announcements.view"), announcementsController.showAnnouncement);
router.post("/super-admin/announcements/:id/publish", platformRequire("announcements.manage"), announcementsController.publishAnnouncement);
router.post("/super-admin/announcements/:id/delete", platformRequire("announcements.manage"), announcementsController.deleteAnnouncement);

module.exports = router;
