const express = require("express");
const router = express.Router();
const upload = require("../../../middleware/uploadMemory");
const ctrl = require("../../../controllers/tenant/public/scholarshipsPublicController");

router.get("/", ctrl.listPublic);
router.get("/status", ctrl.statusPage);
router.post("/status", ctrl.checkStatus);
router.get("/:id", ctrl.viewPublic);
router.get("/:id/apply", ctrl.applyPage);
router.post("/:id/apply", upload.fields([
  { name: "transcript", maxCount: 1 },
  { name: "idDocument", maxCount: 1 },
  { name: "recommendationLetter", maxCount: 1 },
  { name: "otherDocs", maxCount: 8 },
]), ctrl.submitApplication);

module.exports = router;
