const express = require("express");
const multer = require("multer");
const router = express.Router();
const departments = require("../../../controllers/tenant/admin/departmentsController");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
});

router.get("/", departments.list);
router.post("/", departments.deptRules, departments.create);
router.post("/:id", departments.deptRules, departments.update);
router.post("/:id/delete", departments.remove);
router.post("/bulk-status", departments.bulkStatus);
router.post("/bulk-delete", departments.bulkDelete);
router.post("/import", upload.single("file"), departments.importCsv);

module.exports = router;