const express = require("express");
const router = express.Router();

const tenantAuth = require("../../../middleware/tenant/requireTenantAuth");
const ctrl = require("../../../controllers/tenant/admin/assignmentController");

const multer = require("multer");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Protect all admin routes
router.use(tenantAuth("admin"));

// List
router.get("/", ctrl.list);

// Create / Update
router.post("/", ctrl.assignmentRules, ctrl.create);
router.post("/:id", ctrl.assignmentRules, ctrl.update);

// Actions
router.post("/:id/publish", ctrl.publish);
router.post("/:id/unpublish", ctrl.unpublish);
router.post("/:id/archive", ctrl.archive);
router.post("/:id/delete", ctrl.remove);

// Bulk
router.post("/bulk", ctrl.bulk);

// Import / Export
router.post("/import", upload.single("file"), ctrl.importCsv);
router.get("/export", ctrl.exportCsv);

module.exports = router;
