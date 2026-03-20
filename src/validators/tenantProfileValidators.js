const { body } = require("express-validator");

const hexColor = (v) => /^#[0-9a-fA-F]{6}$/.test(v);

module.exports = {
  updateProfile: [
    body("name").optional().isString().trim().isLength({ min: 2, max: 120 }),

    body("profile.enabled").optional().isBoolean().toBoolean(),
    body("profile.verified").optional().isBoolean().toBoolean(),

    body("profile.type").optional().isString().trim().isLength({ max: 60 }),
    body("profile.tagline").optional().isString().trim().isLength({ max: 160 }),
    body("profile.city").optional().isString().trim().isLength({ max: 80 }),
    body("profile.address").optional().isString().trim().isLength({ max: 200 }),
    body("profile.system").optional().isString().trim().isLength({ max: 80 }),
    body("profile.foundedYear").optional().isInt({ min: 1500, max: 2100 }).toInt(),

    body("profile.about").optional().isString().trim().isLength({ max: 3000 }),
    body("profile.mission").optional().isString().trim().isLength({ max: 800 }),
    body("profile.vision").optional().isString().trim().isLength({ max: 800 }),

    body("profile.contact.phone").optional().isString().trim().isLength({ max: 40 }),
    body("profile.contact.email").optional().isEmail().normalizeEmail().isLength({ max: 120 }),
    body("profile.contact.website").optional().isURL({ require_protocol: true }),

    body("profile.socials.facebook").optional().isURL({ require_protocol: true }),
    body("profile.socials.instagram").optional().isURL({ require_protocol: true }),
    body("profile.socials.x").optional().isURL({ require_protocol: true }),
    body("profile.socials.youtube").optional().isURL({ require_protocol: true }),
    body("profile.socials.tiktok").optional().isURL({ require_protocol: true }),

    body("profile.location.googleMapUrl").optional().isURL({ require_protocol: true }),
    body("profile.location.lat").optional().isFloat({ min: -90, max: 90 }).toFloat(),
    body("profile.location.lng").optional().isFloat({ min: -180, max: 180 }).toFloat(),

    body("branding.primaryColor").optional().custom(hexColor),
    body("branding.accentColor").optional().custom(hexColor),
  ],

  submitReview: [
    body("name").isString().trim().isLength({ min: 2, max: 60 }),
    body("email").optional().isEmail().normalizeEmail().isLength({ max: 120 }),
    body("rating").isInt({ min: 1, max: 5 }).toInt(),
    body("title").optional().isString().trim().isLength({ max: 80 }),
    body("message").optional().isString().trim().isLength({ max: 1200 }),
  ],
};
