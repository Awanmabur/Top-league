const express = require("express");
const router = express.Router();

const attendanceController = require("../../../controllers/tenant/parents/attendanceController");

router.get("/attendance", attendanceController.index);

module.exports = router;