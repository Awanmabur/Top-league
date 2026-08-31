const express = require("express");
const router = express.Router();

const ctrl = require("../../../controllers/tenant/admin/reportsController");
const { createCsvUpload, validateCsvUpload } = require("../../../middleware/csvUpload");

const upload = createCsvUpload({ maxBytes: 2 * 1024 * 1024 });

router.get("/", ctrl.reportsPage);
router.get("/export", ctrl.exportCsv);
router.post("/import", upload.single("file"), validateCsvUpload, ctrl.importCsv);

router.get("/exports/:id/download", ctrl.downloadExport);
router.post("/exports/:id/delete", ctrl.deleteExport);

module.exports = router;