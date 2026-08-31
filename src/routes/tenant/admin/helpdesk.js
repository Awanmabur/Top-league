const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/admin/helpdeskController");

router.get("/", ctrl.index);
router.get("/export", ctrl.exportCsv);
router.get("/templates", ctrl.templates);
router.post("/templates", ctrl.createTemplate);
router.post("/templates/:id/delete", ctrl.deleteTemplate);
router.post("/", ctrl.create);
router.post("/bulk", ctrl.bulkAction);
router.post("/:id/update", ctrl.update);
router.post("/:id/reply", ctrl.reply);
router.post("/:id/progress", ctrl.progress);
router.post("/:id/resolve", ctrl.resolve);
router.post("/:id/close", ctrl.close);
router.post("/:id/delete", ctrl.delete);

module.exports = router;
