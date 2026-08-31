// routes/tenant/public/admissionsRoutes.js
const express = require("express");
const router = express.Router();

const admissionsCtrl = require("../../../controllers/tenant/public/admissionsController");
const upload = require("../../../middleware/uploadMemory"); // your multer memory storage
const { validateBufferedUploads } = require("../../../middleware/validateBufferedUploads");
const validateDocs = validateBufferedUploads();
const { publicUploadLimiter, publicStatusLimiter } = require("../../../middleware/tenant/rateLimiters");

const applicantUploads = upload.fields([
  { name: "passportPhoto", maxCount: 1 },
  { name: "idDocument", maxCount: 1 },
  { name: "transcript", maxCount: 1 },
  { name: "otherDocs", maxCount: 8 },
]);

router.get("/apply", admissionsCtrl.applyPage);
router.get("/admissions/apply", admissionsCtrl.applyPage);
router.post("/admissions/upload-draft", publicUploadLimiter, applicantUploads, validateDocs, admissionsCtrl.uploadDraftFiles);
router.post("/apply", publicUploadLimiter, applicantUploads, validateDocs, admissionsCtrl.submitApplication);
router.post("/admissions/apply", publicUploadLimiter, applicantUploads, validateDocs, admissionsCtrl.submitApplication);

router.get("/admissions/status", admissionsCtrl.statusPage);
router.post("/admissions/status", publicStatusLimiter, admissionsCtrl.checkStatus);

module.exports = router;
