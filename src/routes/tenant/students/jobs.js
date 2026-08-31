const express = require("express");
const router = express.Router();
const jobsController = require("../../../controllers/tenant/students/jobsController");

router.get("/jobs", jobsController.jobs);
router.post("/jobs/:jobId/apply", jobsController.apply);
router.post("/jobs/applications/:applicationId/withdraw", jobsController.withdraw);

module.exports = router;
