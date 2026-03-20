const express = require("express");
const router = express.Router();

const ctrl = require("../../../controllers/tenant/admin/disciplineController");
const upload = require("../../../utils/uploadMemory");

router.get("/", ctrl.index);
router.post("/", ctrl.create);
router.post("/:id", ctrl.update);
router.post("/:id/action", ctrl.addAction);

// student statement upload
router.post("/:id/statement", upload.single("file"), ctrl.uploadStatement);

// attachments upload
router.post("/:id/attachments", upload.array("files", 5), ctrl.uploadAttachments);

router.post("/:id/delete", ctrl.softDelete);

module.exports = router;