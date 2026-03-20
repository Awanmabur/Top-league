const express = require("express");
const multer = require("multer");

const router = express.Router();

const tenantAuth = require("../../../middleware/tenant/requireTenantAuth");
const ctrl = require("../../../controllers/tenant/admin/attendanceController");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.use(tenantAuth("admin"));

router.get("/sheet", ctrl.sheet);
router.post("/sheet", ctrl.saveSheet);

router.get("/import-template", ctrl.importTemplate);
router.post("/import", upload.single("file"), ctrl.importCsv);
router.get("/export", ctrl.exportCsv);

router.get("/", ctrl.list);
router.post("/", ctrl.attendanceRules, ctrl.create);
router.post("/bulk", ctrl.bulk);
router.post("/:id/delete", ctrl.remove);
router.post("/:id", ctrl.attendanceRules, ctrl.update);

module.exports = router;