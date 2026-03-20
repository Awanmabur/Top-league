const express = require("express");
const router = express.Router();

const ctrl = require("../../../controllers/tenant/admin/studentDocsController");
const upload = require("../../../utils/uploadMemory");

router.get("/", ctrl.index);
router.post("/", upload.single("file"), ctrl.create);
router.post("/:id", upload.single("file"), ctrl.update);
router.post("/:id/delete", ctrl.softDelete);

module.exports = router;