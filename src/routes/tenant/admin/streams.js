const express = require("express");
const controller = require("../../../controllers/tenant/admin/streamsController");
 
const router = express.Router();

router.get("/", controller.list);
router.post("/", controller.streamRules, controller.create);
router.post("/bulk", controller.bulk);
router.post("/:id", controller.streamRules, controller.update);
router.post("/:id/status", controller.setStatus);
router.post("/:id/delete", controller.remove);

module.exports = router;