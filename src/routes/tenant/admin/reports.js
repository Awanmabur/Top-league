const express = require("express");
const multer = require("multer");
const router = express.Router();

const ctrl = require("../../../controllers/tenant/admin/reportsController");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const ok =
      file &&
      (
        file.mimetype === "text/csv" ||
        file.mimetype === "application/vnd.ms-excel" ||
        /\.csv$/i.test(file.originalname || "")
      );

    if (!ok) return cb(new Error("Only CSV files are allowed."));
    cb(null, true);
  },
});

router.get("/", ctrl.reportsPage);
router.get("/export", ctrl.exportCsv);
router.post("/import", upload.single("file"), ctrl.importCsv);

router.get("/exports/:id/download", ctrl.downloadExport);
router.post("/exports/:id/delete", ctrl.deleteExport);

module.exports = router;