const express = require("express");
const router = express.Router();
const timetableController = require("../../../controllers/tenant/students/timetableController");

router.get("/timetable", timetableController.timetable);

module.exports = router;