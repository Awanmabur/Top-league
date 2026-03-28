 
const express = require("express");
const router = express.Router();
const multer = require("multer");

const ctrl = require("../../../controllers/tenant/admin/studentsController");

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

router.get("/", ctrl.list);
router.post("/", ctrl.studentRules, ctrl.create);
router.post("/:id", ctrl.studentRules, ctrl.update);
router.post("/:id/archive", ctrl.archive);
router.post("/:id/delete", ctrl.remove);
router.post("/:id/resend-setup", ctrl.resendSetupLink);
router.post("/bulk", ctrl.bulk);
router.post("/import", upload.single("file"), ctrl.importCsv);
// router.get("/export", ctrl.exportCsv);

module.exports = router;