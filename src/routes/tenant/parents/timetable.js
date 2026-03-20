const express = require("express");
const router = express.Router();

const timetableController = require("../../../controllers/tenant/parents/timetableController");

router.get("/timetable", timetableController.index);

module.exports = router;