 
const express = require("express");
const router = express.Router();
const multer = require("multer");

const ctrl = require("../../../controllers/tenant/admin/studentsController");
const uploadDocs = require("../../../middleware/uploadMemory");

const upload = multer({
storage: multer.memoryStorage(),
limits: {
fileSize: 5 * 1024 * 1024,
files: 1,
},
fileFilter: (req, file, cb) => {
const ok = /csv|plain/.test(String(file.mimetype || "")) || /\.csv$/i.test(file.originalname || "");
if (!ok) return cb(new Error("Only CSV files are allowed."));
cb(null, true);
},
});

const studentUploads = uploadDocs.fields([
  { name: "passportPhoto", maxCount: 1 },
  { name: "idDocument", maxCount: 1 },
  { name: "transcript", maxCount: 1 },
  { name: "otherDocs", maxCount: 8 },
]);

router.get("/", ctrl.list);
router.get("/import", (req, res) => res.redirect("/admin/students?import=1"));
router.post("/", studentUploads, ctrl.studentRules, ctrl.create);
router.post("/bulk", ctrl.bulk);
router.post("/import", upload.single("file"), ctrl.importCsv);
router.post("/:id", studentUploads, ctrl.studentRules, ctrl.update);
router.post("/:id/archive", ctrl.archive);
router.post("/:id/delete", ctrl.remove);
router.post("/:id/resend-setup", ctrl.resendSetupLink);
// router.get("/export", ctrl.exportCsv);

module.exports = router;
