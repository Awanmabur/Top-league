const express = require("express");
const multer = require("multer");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/admin/assignmentController");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /csv|plain/.test(String(file.mimetype || "").toLowerCase()) || /\.csv$/i.test(String(file.originalname || ""));
    if (!ok) return cb(new Error("Only CSV files are allowed."));
    return cb(null, true);
  },
});

router.get("/", ctrl.list);
router.get("/export.csv", ctrl.exportCsv);
router.post("/", ctrl.assignmentRules, ctrl.create);
router.post("/import", upload.single("file"), ctrl.importCsv);
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
