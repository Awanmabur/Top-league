const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/admin/assignmentController");
const { createCsvUpload, validateCsvUpload } = require("../../../middleware/csvUpload");

const upload = createCsvUpload({ maxBytes: 2 * 1024 * 1024 });

router.get("/", ctrl.list);
router.get("/export.csv", ctrl.exportCsv);
router.post("/", ctrl.assignmentRules, ctrl.create);
router.post("/import", upload.single("file"), validateCsvUpload, ctrl.importCsv);
router.post("/bulk", ctrl.bulk);

router.get("/:id/submissions", ctrl.submissions);
router.post("/:id/submissions/:submissionId/grade", ctrl.gradeSubmission);
router.post("/:id/submissions/:submissionId/reopen", ctrl.reopenSubmission);

router.post("/:id/publish", ctrl.publish);
router.post("/:id/unpublish", ctrl.unpublish);
router.post("/:id/close", ctrl.close);
router.post("/:id/reopen", ctrl.reopen);
router.post("/:id/archive", ctrl.archive);
router.post("/:id/delete", ctrl.remove);
router.post("/:id", ctrl.assignmentRules, ctrl.update);

module.exports = router;
