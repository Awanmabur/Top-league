const express = require("express");
const router = express.Router();
const eventsController = require("../../../controllers/tenant/students/eventsController");

router.get("/events", eventsController.events);
router.get("/events/calendar.ics", eventsController.calendar);
router.post("/events/alerts", eventsController.toggleAlerts);
router.post("/events/:id/register", eventsController.register);
router.post("/events/:id/cancel-registration", eventsController.cancelRegistration);

module.exports = router;
