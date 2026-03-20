const express = require("express");
const router = express.Router();
const eventsController = require("../../../controllers/tenant/students/eventsController");

router.get("/events", eventsController.events);

module.exports = router;