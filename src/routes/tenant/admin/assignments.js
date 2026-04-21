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
router.get("/export", ctrl.exportCsv);

// Create / Update
router.post("/", ctrl.assignmentRules, ctrl.create);

// Bulk
router.post("/bulk", ctrl.bulk);

// Import
router.post("/import", upload.single("file"), ctrl.importCsv);

// Actions
router.post("/:id/publish", ctrl.publish);
router.post("/:id/unpublish", ctrl.unpublish);
router.post("/:id/archive", ctrl.archive);
router.post("/:id/delete", ctrl.remove);
router.post("/:id", ctrl.assignmentRules, ctrl.update);

module.exports = router;
