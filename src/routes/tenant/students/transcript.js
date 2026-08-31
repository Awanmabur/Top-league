const express = require("express");
const router = express.Router();
const transcriptController = require("../../../controllers/tenant/students/transcriptController");

router.get("/transcript/:id/print", transcriptController.printOfficial);
router.get("/letters/:id/print", transcriptController.printLetter);
router.post("/letters/request", transcriptController.requestLetter);
router.post("/letters/:id/cancel", transcriptController.cancelLetter);
router.get("/transcript", transcriptController.transcript);

module.exports = router;
