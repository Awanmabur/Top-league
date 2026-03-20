const express = require("express");
const router = express.Router();
const transcriptController = require("../../../controllers/tenant/students/transcriptController");

router.get("/transcript", transcriptController.transcript);

module.exports = router;