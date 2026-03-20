const express = require("express");
const router = express.Router();
const jobsController = require("../../../controllers/tenant/students/jobsController");

router.get("/jobs", jobsController.jobs);

module.exports = router;