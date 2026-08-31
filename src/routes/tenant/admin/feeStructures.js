const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/tenant/admin/feeStructuresController");

router.get("/", controller.index);
router.get("/export.csv", controller.exportCsv);
router.post("/", controller.create);
router.post("/bulk", controller.bulk);
router.post("/:id/update", controller.update);
router.post("/:id/activate", controller.activate);
router.post("/:id/inactive", controller.inactive);
router.post("/:id/archive", controller.archive);
router.post("/:id/delete", controller.remove);

module.exports = router;
