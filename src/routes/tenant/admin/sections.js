const express = require("express");
const controller = require("../../../controllers/tenant/admin/sectionsController");
 
const router = express.Router();

router.get("/", controller.list);
router.post("/", controller.sectionRules, controller.create);
router.post("/:id", controller.sectionRules, controller.update);
router.post("/:id/status", controller.setStatus);
router.post("/:id/delete", controller.remove);
router.post("/bulk", controller.bulk);

module.exports = router;
