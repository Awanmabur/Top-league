const express = require("express");
const multer = require("multer");
const ctrl = require("../../../controllers/tenant/admin/notificationsController");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const ok = /csv|plain/.test(String(file.mimetype || "")) || /\.csv$/i.test(String(file.originalname || ""));
    if (!ok) return cb(new Error("Only CSV files are allowed."));
    cb(null, true);
  },
});

router.get("/", ctrl.page);
router.post("/new", ctrl.create);
router.post("/import", upload.single("file"), ctrl.importCsv);
router.post("/:id/read", ctrl.markRead);
router.post("/:id/unread", ctrl.markUnread);
router.post("/:id/delete", ctrl.deleteOne);
router.post("/bulk", ctrl.bulk);
router.post("/mark-all-read", ctrl.markAllRead);

module.exports = router;