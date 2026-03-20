const express = require("express");
const router = express.Router();
const coursesController = require("../../../controllers/tenant/students/coursesController");

router.get("/courses", coursesController.courses);

module.exports = router;