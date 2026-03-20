const rateLimit = require("express-rate-limit");

const jsonMsg = (message) => (req, res) => res.status(429).json({ ok: false, message });

const publicInquiryLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonMsg("Too many inquiries. Try again in a few minutes."),
});

const publicReviewLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonMsg("Too many reviews. Try again later."),
});

module.exports = { publicInquiryLimiter, publicReviewLimiter };
