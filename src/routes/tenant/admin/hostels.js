const express = require("express");
const router = express.Router();
const hostelsController = require("../../../controllers/tenant/admin/hostelsController");

router.get("/", hostelsController.index);
router.get("/export.csv", hostelsController.exportCsv);
router.get("/report", hostelsController.report);
router.post("/policies", hostelsController.savePolicies);
router.post("/rooms", hostelsController.createRoom);
router.post("/rooms/:id/update", hostelsController.updateRoom);
router.post("/rooms/:id/allocate", hostelsController.allocateStudent);
router.post("/allocations/:allocationId/vacate", hostelsController.vacateStudent);
router.post("/rooms/:id/maintenance", hostelsController.createMaintenanceTicket);
router.post("/rooms/:roomId/maintenance/:ticketId/status", hostelsController.updateMaintenanceStatus);
router.post("/rooms/:roomId/applications/:applicationId/status", hostelsController.changeApplicationStatus);

module.exports = router;
