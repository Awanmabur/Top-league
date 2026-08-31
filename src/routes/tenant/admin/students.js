 
const express = require("express");
const router = express.Router();

const ctrl = require("../../../controllers/tenant/admin/studentsController");
const uploadDocs = require("../../../middleware/uploadMemory");
const { validateBufferedUploads } = require("../../../middleware/validateBufferedUploads");
const { createCsvUpload, validateCsvUpload } = require("../../../middleware/csvUpload");
const validateDocs = validateBufferedUploads();

const studentUploads = uploadDocs.fields([
  { name: "passportPhoto", maxCount: 1 },
  { name: "idDocument", maxCount: 1 },
  { name: "transcript", maxCount: 1 },
  { name: "otherDocs", maxCount: 8 },
]);

const upload = createCsvUpload({ maxBytes: 5 * 1024 * 1024 });

router.get("/", ctrl.list);
router.get("/import", (req, res) => res.redirect("/admin/students?import=1"));
router.post("/", studentUploads, validateDocs, ctrl.studentRules, ctrl.create);
router.post("/bulk", ctrl.bulk);
router.post("/import", upload.single("file"), validateCsvUpload, ctrl.importCsv);
router.post("/:id", studentUploads, validateDocs, ctrl.studentRules, ctrl.update);
router.post("/:id/archive", ctrl.archive);
router.post("/:id/delete", ctrl.remove);
router.post("/:id/resend-setup", ctrl.resendSetupLink);
router.get("/export", ctrl.exportCsv);

module.exports = router;