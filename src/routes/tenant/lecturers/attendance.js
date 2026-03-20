const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/lecturers/attendanceController");

// Attendance per class section
router.get("/attendance/:classSectionId", ctrl.page);
router.post("/attendance/:classSectionId", ctrl.save);

module.exports = router;
