const express = require("express");
const multer = require("multer");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/admin/resultsController");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const ok =
      /csv|plain/.test(String(file.mimetype || "").toLowerCase()) ||
      /\.csv$/i.test(String(file.originalname || ""));
    if (!ok) return cb(new Error("Only CSV files are allowed."));
    cb(null, true);
  },
});

router.get("/", ctrl.list);
router.get("/options", ctrl.options);
router.get("/export.csv", ctrl.exportCsv);

router.post("/", ctrl.resultRules, ctrl.create);
router.post("/import", upload.single("file"), ctrl.importCsv);
router.post("/bulk", ctrl.bulk);
router.post("/:id", ctrl.resultRules, ctrl.update);
router.post("/:id/status", ctrl.setStatus);
router.post("/:id/delete", ctrl.remove);

module.exports = router;