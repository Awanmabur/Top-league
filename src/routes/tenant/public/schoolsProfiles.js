const express = require("express");
const router = express.Router();

const resolveTenantByCode = require("../../../middleware/tenant/resolveTenantByCode");
const { publicInquiryLimiter, publicReviewLimiter } = require("../../../middleware/tenant/rateLimiters");

const ctrl = require("../../../controllers/tenant/public/schoolProfilePublicController");

router.get("/:code", resolveTenantByCode, ctrl.page);
router.post("/:code/inquiry", publicInquiryLimiter, resolveTenantByCode, ctrl.inquiry);
router.post("/:code/reviews", publicReviewLimiter, resolveTenantByCode, ctrl.review);

module.exports = router;

