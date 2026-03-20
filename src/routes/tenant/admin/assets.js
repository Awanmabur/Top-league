const express = require("express");
const router = express.Router();
const assetsController = require("../../../controllers/tenant/admin/assetsController");

router.get("/", assetsController.index);
router.post("/", assetsController.createAsset);
router.post("/:id/update", assetsController.updateAsset);
router.post("/:id/assign", assetsController.assignAsset);
router.post("/:id/maintenance", assetsController.createMaintenance);

module.exports = router;