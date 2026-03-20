const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/lecturers/announcementsController");

// list + create announcements (for lecturer announcements page)
router.get("/announcements", ctrl.list);
router.post("/announcements", ctrl.create);

module.exports = router;
