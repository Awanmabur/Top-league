const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/lecturers/timetableController");

router.get("/timetable", ctrl.timetable);

module.exports = router;
