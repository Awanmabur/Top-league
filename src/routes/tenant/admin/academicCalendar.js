const express = require("express");
const router = express.Router();

const ctrl = require("../../../controllers/tenant/admin/academicCalendarController");

// multer for CSV upload
const multer = require("multer");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
});

// NOTE: no router.use(auth) here (admin/index already protects)

// List: GET /admin/academic-calendar
router.get("/", ctrl.list);
router.get("/export", ctrl.exportCsv);

// Create: POST /admin/academic-calendar
router.post("/", ctrl.eventRules, ctrl.create);

// Bulk
router.post("/bulk-archive", ctrl.bulkArchive);

// Import
router.post("/import", upload.single("file"), ctrl.importCsv);

// Archive/Delete
router.post("/:id/archive", ctrl.archive);
router.post("/:id/delete", ctrl.remove);

// Update: POST /admin/academic-calendar/:id
router.post("/:id", ctrl.eventRules, ctrl.update);

module.exports = router;