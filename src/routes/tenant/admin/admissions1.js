const express = require("express");
const router = express.Router();
const uploadDocs = require("../../../middleware/tenant/uploadApplicantDocs");

const admissions = require("../../../controllers/tenant/admin/admissionsController");
const review = require("../../../controllers/tenant/admin/reviewController");

router.get("/", admissions.listApplicants);
router.get("/:id", admissions.viewApplicant);

router.post("/submit", uploadDocs, admissions.submitApplication);

router.post("/:id/review", review.startReview);
router.post("/:id/accept", review.acceptApplicant);
router.post("/:id/reject", review.rejectApplicant);

module.exports = router;
