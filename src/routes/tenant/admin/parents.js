const express = require("express");
const router = express.Router();

const ctrl = require("../../../controllers/tenant/admin/parentsController");
const { createCsvUpload, validateCsvUpload } = require("../../../middleware/csvUpload");

const upload = createCsvUpload({ maxBytes: 2 * 1024 * 1024 });

router.get("/", ctrl.list);
router.get("/export", ctrl.exportCsv);
router.post("/", ctrl.parentRules, ctrl.create);
router.post("/import", upload.single("file"), validateCsvUpload, ctrl.importCsv);
router.post("/bulk-archive", ctrl.bulkArchive);
router.post("/bulk-resend-setup", ctrl.bulkResendSetupLinks);

router.post("/:id", ctrl.parentRules, ctrl.update);
router.post("/:id/archive", ctrl.archive);
router.post("/:id/delete", ctrl.remove);
router.post("/:id/resend-setup", ctrl.resendSetupLink);

module.exports = router;