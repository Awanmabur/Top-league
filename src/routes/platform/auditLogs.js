const express = require("express");
const router = express.Router();
const auditLogsController = require("../../controllers/platform/auditLogsController");

router.get("/super-admin/audit-logs", auditLogsController.listAuditLogs);
router.get("/super-admin/audit-logs/:id", auditLogsController.showAuditLog);

module.exports = router;