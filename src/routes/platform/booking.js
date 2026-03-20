// src/routes/booking.js
const express = require("express");
const router = express.Router();

const bookingController = require("../../controllers/platform/bookingController");

router.get("/schedule", bookingController.bookingCsp, bookingController.renderSchedule);

router.get("/google/auth", bookingController.googleAuth);
router.get("/oauth2/callback", bookingController.oauthCallback);

router.get("/api/month-availability",
  bookingController.bookingApiLimiter,
  bookingController.monthAvailability,
);

router.get("/api/availability",
  bookingController.bookingApiLimiter,
  bookingController.dayAvailability,
);

router.post("/api/book",
  bookingController.bookingApiLimiter,
  bookingController.book,
);

module.exports = router;