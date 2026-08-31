// routes/tenant/public/admissionsRoutes.js
const express = require("express");
const router = express.Router();

const admissionsCtrl = require("../../../controllers/tenant/public/admissionsController");
const upload = require("../../../middleware/uploadMemory"); // your multer memory storage

const applicantUploads = upload.fields([
  { name: "passportPhoto", maxCount: 1 },
  { name: "idDocument", maxCount: 1 },
  { name: "transcript", maxCount: 1 },
  { name: "otherDocs", maxCount: 8 },
]);

router.get("/apply", admissionsCtrl.applyPage);
router.get("/admissions/apply", admissionsCtrl.applyPage);
router.post("/admissions/upload-draft", applicantUploads, admissionsCtrl.uploadDraftFiles);
router.post("/apply", applicantUploads, admissionsCtrl.submitApplication);
router.post("/admissions/apply", applicantUploads, admissionsCtrl.submitApplication);

router.get("/admissions/status", admissionsCtrl.statusPage);
router.post("/admissions/status", admissionsCtrl.checkStatus);

module.exports = router;
