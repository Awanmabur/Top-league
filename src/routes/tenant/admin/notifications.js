const express = require("express");
const ctrl = require("../../../controllers/tenant/admin/notificationsController");
const { createCsvUpload, validateCsvUpload } = require("../../../middleware/csvUpload");

const router = express.Router();

const upload = createCsvUpload({ maxBytes: 2 * 1024 * 1024 });

router.get("/", ctrl.page);
router.post("/new", ctrl.create);
router.post("/import", upload.single("file"), validateCsvUpload, ctrl.importCsv);
router.post("/:id/read", ctrl.markRead);
router.post("/:id/unread", ctrl.markUnread);
router.post("/:id/delete", ctrl.deleteOne);
router.post("/bulk", ctrl.bulk);
router.post("/mark-all-read", ctrl.markAllRead);

module.exports = router;