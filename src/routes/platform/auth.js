const express = require("express");
const router = express.Router();
const authController = require("../../controllers/platform/authController");
const { csrfProtection, attachCsrfToken } = require("../../middleware/tenant/csrf");
const { authLimiter } = require("../../middleware/tenant/rateLimiters");
const { platformAdminOnly } = require("../../middleware/platform/guards");

router.get("/super-admin/login", csrfProtection, attachCsrfToken, authController.loginForm);
router.post("/super-admin/login", authLimiter, csrfProtection, attachCsrfToken, authController.login);
router.post("/super-admin/logout", authController.logout);

router.get("/super-admin/forgot-password", authController.forgotPasswordForm);
router.post("/super-admin/forgot-password", authController.forgotPassword);

router.get("/super-admin/reset-password/:token", authController.resetPasswordForm);
router.post("/super-admin/reset-password/:token", authController.resetPassword);

router.get("/super-admin/platform-users/create", platformAdminOnly, authController.createPlatformUserForm);
router.post("/super-admin/platform-users/create", platformAdminOnly, authController.createPlatformUser);

module.exports = router;
