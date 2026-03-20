 
// src/routes/superadmin/index.js
const express = require("express");
const router = express.Router();

router.use("/", require("./auth"));
router.use("/", require("./dashboard"));
router.use("/", require("./tenants"));
router.use("/", require("./plans"));
router.use("/", require("./reports"));
router.use("/", require("./billing"));
router.use("/", require("./announcements"));
router.use("/", require("./auditLogs"));
router.use("/", require("./supportTickets"));
router.use("/", require("./settings"));
router.use("/", require("./booking"));
router.use("/", require("./pages"));

module.exports = router;