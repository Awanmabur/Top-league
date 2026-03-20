const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/lecturers/coursesController");

router.get("/courses", ctrl.courses);

module.exports = router;
