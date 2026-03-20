const express = require("express");
const router = express.Router();
const attendanceController = require("../../../controllers/tenant/students/attendanceController");

router.get("/attendance", attendanceController.attendance);

module.exports = router;