const express = require("express");
const router = express.Router();

const timetableCtrl = require("../../../controllers/tenant/admin/timetableController");
const { createCsvUpload, validateCsvUpload } = require("../../../middleware/csvUpload");

const upload = createCsvUpload({ maxBytes: 2 * 1024 * 1024 });

router.get("/export.csv", timetableCtrl.exportCsv);
router.get("/", timetableCtrl.list);
router.post("/", timetableCtrl.timetableRules, timetableCtrl.create);
router.post("/import", upload.single("file"), validateCsvUpload, timetableCtrl.importCsv);
router.post("/bulk", timetableCtrl.bulk);
router.post("/:id", timetableCtrl.timetableRules, timetableCtrl.update);
router.post("/:id/status", timetableCtrl.setStatus);
router.post("/:id/delete", timetableCtrl.remove);

module.exports = router;