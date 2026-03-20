const express = require("express");
const multer = require("multer");
const router = express.Router();

const examsCtrl = require("../../../controllers/tenant/admin/examsController");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const ok =
      /csv|text\/csv|application\/vnd\.ms-excel/i.test(file.mimetype) ||
      /\.csv$/i.test(file.originalname || "");
    cb(ok ? null : new Error("Only CSV files are allowed."), ok);
  },
});

// list
router.get("/", examsCtrl.list);

// export csv
router.get("/export", examsCtrl.exportCsv);

// import csv
router.post("/import", upload.single("file"), examsCtrl.importCsv);

// create
router.post("/", examsCtrl.examRules, examsCtrl.create);

// update
router.post("/:id", examsCtrl.examRules, examsCtrl.update);

// status
router.post("/:id/status", examsCtrl.setStatus);

// delete
router.post("/:id/delete", examsCtrl.remove);

// bulk
router.post("/bulk", examsCtrl.bulk);

module.exports = router;