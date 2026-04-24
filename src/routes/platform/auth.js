const express = require("express");
const router = express.Router();
const authController = require("../../controllers/platform/authController");
const { csrfProtection, attachCsrfToken } = require("../../middleware/tenant/csrf");
const { authLimiter } = require("../../middleware/tenant/rateLimiters");
const { platformAdminOnly } = require("../../middleware/platform/guards");

router.get(["/login", "/super-admin/login"], csrfProtection, attachCsrfToken, authController.loginForm);
router.post(["/login", "/super-admin/login"], authLimiter, csrfProtection, attachCsrfToken, authController.login);
router.post(["/logout", "/super-admin/logout"], authController.logout);

router.get(["/forgot-password", "/super-admin/forgot-password"], csrfProtection, attachCsrfToken, authController.forgotPasswordForm);
router.post(["/forgot-password", "/super-admin/forgot-password"], authLimiter, csrfProtection, attachCsrfToken, authController.forgotPassword);

router.get(["/reset-password/:token", "/super-admin/reset-password/:token"], csrfProtection, attachCsrfToken, authController.resetPasswordForm);
router.post(["/reset-password/:token", "/super-admin/reset-password/:token"], authLimiter, csrfProtection, attachCsrfToken, authController.resetPassword);

router.get("/super-admin/platform-users/create", platformAdminOnly, csrfProtection, attachCsrfToken, authController.createPlatformUserForm);
router.post("/super-admin/platform-users/create", platformAdminOnly, csrfProtection, attachCsrfToken, authController.createPlatformUser);

module.exports = router;

