const express = require("express");
const multer = require("multer");
const router = express.Router();

const ctrl = require("../../../controllers/tenant/admin/parentsController");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const ok =
      file &&
      (file.mimetype === "text/csv" ||
        file.mimetype === "application/vnd.ms-excel" ||
        /\.csv$/i.test(file.originalname || ""));
    if (!ok) return cb(new Error("Only CSV files are allowed."));
    cb(null, true);
  },
});

router.get("/", ctrl.list);
router.post("/", ctrl.parentRules, ctrl.create);
router.post("/import", upload.single("file"), ctrl.importCsv);
router.post("/bulk-archive", ctrl.bulkArchive);
router.post("/bulk-resend-setup", ctrl.bulkResendSetupLinks);

router.post("/:id", ctrl.parentRules, ctrl.update);
router.post("/:id/archive", ctrl.archive);
router.post("/:id/delete", ctrl.remove);
router.post("/:id/resend-setup", ctrl.resendSetupLink);

module.exports = router;