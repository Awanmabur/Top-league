const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/staff/announcementsController");

router.get("/announcements", ctrl.list);

module.exports = router;
