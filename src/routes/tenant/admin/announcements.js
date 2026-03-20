const express = require("express");
const router = express.Router();

const ctrl = require("../../../controllers/tenant/admin/announcementsController");
 
router.get("/", ctrl.index);
router.post("/", ctrl.create);
router.post("/bulk", ctrl.bulkAction);
router.post("/:id/update", ctrl.update);
router.post("/:id/publish", ctrl.publish);
router.post("/:id/unpublish", ctrl.unpublish);
router.post("/:id/delete", ctrl.delete);

module.exports = router;