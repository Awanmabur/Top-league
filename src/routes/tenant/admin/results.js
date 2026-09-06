const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/admin/resultsController");
const { createCsvUpload, validateCsvUpload } = require("../../../middleware/csvUpload");

const upload = createCsvUpload({ maxBytes: 2 * 1024 * 1024 });

router.get("/", ctrl.list);
router.get("/options", ctrl.options);
router.get("/export.csv", ctrl.exportCsv);

router.post("/", ctrl.resultRules, ctrl.create);
router.post("/import", upload.single("file"), validateCsvUpload, ctrl.importCsv);
router.post("/bulk", ctrl.bulk);
router.post("/:id", ctrl.resultRules, ctrl.update);
router.post("/:id/status", ctrl.setStatus);
router.post("/:id/delete", ctrl.remove);

module.exports = router;