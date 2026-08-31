const express = require("express");
const multer = require("multer");
const router = express.Router();

const timetableCtrl = require("../../../controllers/tenant/admin/timetableController");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = String(file?.originalname || "").toLowerCase();
    const type = String(file?.mimetype || "").toLowerCase();
    if (name.endsWith(".csv") || type === "text/csv" || type === "text/plain" || type === "application/vnd.ms-excel") return cb(null, true);
    return cb(new Error("Only CSV files are allowed."));
  },
});

router.get("/export.csv", timetableCtrl.exportCsv);
router.get("/", timetableCtrl.list);
router.post("/", timetableCtrl.timetableRules, timetableCtrl.create);
router.post("/import", upload.single("file"), timetableCtrl.importCsv);
router.post("/bulk", timetableCtrl.bulk);
router.post("/:id", timetableCtrl.timetableRules, timetableCtrl.update);
router.post("/:id/status", timetableCtrl.setStatus);
router.post("/:id/delete", timetableCtrl.remove);

module.exports = router;