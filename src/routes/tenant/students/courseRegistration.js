const express = require("express");
const router = express.Router();
const courseRegistrationController = require("../../../controllers/tenant/students/courseRegistrationController");

router.get("/course-registration", courseRegistrationController.courseRegistration);

module.exports = router;