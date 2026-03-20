const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/tenant/admin/inquiriesController");

router.get("/", controller.index);
router.post("/bulk", controller.bulk);
router.post("/:id/read", controller.markRead);
router.post("/:id/resolve", controller.markResolved);
router.post("/:id/delete", controller.remove);

module.exports = router;