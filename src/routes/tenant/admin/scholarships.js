const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/admin/scholarshipsController");

router.get("/", ctrl.index);
router.get("/export.csv", ctrl.exportCsv);
router.post("/", ctrl.create);
router.post("/bulk", ctrl.bulkAction);
router.post("/applications/bulk", ctrl.applicationBulk);
router.get("/applications/:appId", ctrl.applicationView);
router.post("/applications/:appId/status", ctrl.applicationStatus);
router.get("/:id/applications", ctrl.applications);
router.get("/:id", ctrl.scholarshipView);
router.post("/:id/update", ctrl.update);
router.post("/:id/activate", ctrl.activate);
router.post("/:id/revoke", ctrl.revoke);
router.post("/:id/expire", ctrl.expire);
router.post("/:id/delete", ctrl.delete);

module.exports = router;
