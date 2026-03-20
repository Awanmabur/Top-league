const express = require("express");
const router = express.Router();
const hostelsController = require("../../../controllers/tenant/admin/hostelsController");

router.get("/", hostelsController.index);
router.post("/rooms", hostelsController.createRoom);
router.post("/rooms/:id/update", hostelsController.updateRoom);
router.post("/rooms/:id/allocate", hostelsController.allocateStudent);
router.post("/rooms/:id/maintenance", hostelsController.createMaintenanceTicket);
router.post("/rooms/:roomId/applications/:applicationId/status", hostelsController.changeApplicationStatus);

module.exports = router;