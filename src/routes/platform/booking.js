const express = require("express");
const router = express.Router();
const bookingController = require("../../controllers/platform/bookingController");

router.get(
  "/schedule",
  bookingController.bookingNonce,
  bookingController.bookingCsp,
  bookingController.renderSchedule,
);

router.get(
  "/api/month-availability",
  bookingController.bookingApiLimiter,
  bookingController.monthAvailability,
);

router.get(
  "/api/availability",
  bookingController.bookingApiLimiter,
  bookingController.dayAvailability,
);

router.post(
  "/api/book",
  bookingController.bookingSubmitLimiter,
  bookingController.book,
);

module.exports = router;
