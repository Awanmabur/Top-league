const rateLimit = require("express-rate-limit");
const { redisRateLimitOptions } = require("../../services/rateLimitStoreFactory");

const jsonMsg = (message) => (req, res) => res.status(429).json({ ok: false, message });

const publicInquiryLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonMsg("Too many inquiries. Try again in a few minutes."),
  ...redisRateLimitOptions("public-inquiry"),
});

const publicReviewLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonMsg("Too many reviews. Try again later."),
  ...redisRateLimitOptions("public-review"),
});


const publicUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonMsg("Too many upload attempts. Try again in a few minutes."),
  ...redisRateLimitOptions("public-upload"),
});

const publicStatusLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonMsg("Too many status checks. Try again in a few minutes."),
  ...redisRateLimitOptions("public-status"),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  ...redisRateLimitOptions("tenant-auth"),
  handler: (req, res) => {
    if (String(req.headers.accept || "").includes("application/json") || req.xhr) {
      return res.status(429).json({
        ok: false,
        message: "Too many login attempts. Try again in a few minutes.",
      });
    }

    return res.status(429).send("Too many login attempts. Try again in a few minutes.");
  },
});

module.exports = { publicInquiryLimiter, publicReviewLimiter, publicUploadLimiter, publicStatusLimiter, authLimiter };
