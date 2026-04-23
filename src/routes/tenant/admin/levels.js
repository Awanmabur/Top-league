const express = require("express");
const controller = require("../../../controllers/tenant/admin/levelsController");

const router = express.Router();

router.get("/", controller.list);
router.post("/", controller.levelRules, controller.create);
router.post("/:schoolUnitCode/:campusCode/:levelCode", controller.levelRules, controller.update);
router.post("/:schoolUnitCode/:campusCode/:levelCode/status", controller.setStatus);
router.post("/:schoolUnitCode/:campusCode/:levelCode/delete", controller.remove);

module.exports = router;