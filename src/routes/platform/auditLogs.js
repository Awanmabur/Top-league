const express = require("express");
const router = express.Router();
const auditLogsController = require("../../controllers/platform/auditLogsController");
const { platformRequire } = require("../../middleware/platform/guards");

router.get("/super-admin/audit-logs", platformRequire("audit.view"), auditLogsController.listAuditLogs);
router.get("/super-admin/audit-logs/:id", platformRequire("audit.view"), auditLogsController.showAuditLog);

module.exports = router;
