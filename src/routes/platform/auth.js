const express = require("express");
const router = express.Router();
const noIndex = require("../../middleware/noIndex");
const authController = require("../../controllers/platform/authController");
const { csrfProtection, attachCsrfToken } = require("../../middleware/tenant/csrf");
const { authLimiter } = require("../../middleware/tenant/rateLimiters");
const { platformAdminOnly, platformOnly } = require("../../middleware/platform/guards");

router.use(["/login", "/super-admin/login", "/forgot-password", "/super-admin/forgot-password", "/reset-password", "/super-admin/reset-password", "/super-admin/verify-login"], noIndex);

router.get(["/login", "/super-admin/login"], csrfProtection, attachCsrfToken, authController.loginForm);
router.post(["/login", "/super-admin/login"], authLimiter, csrfProtection, attachCsrfToken, authController.login);
router.get("/super-admin/verify-login", csrfProtection, attachCsrfToken, authController.twoFactorForm);
router.post("/super-admin/verify-login", authLimiter, csrfProtection, attachCsrfToken, authController.verifyTwoFactor);
router.post(["/logout", "/super-admin/logout"], platformOnly, csrfProtection, attachCsrfToken, authController.logout);

router.get(["/forgot-password", "/super-admin/forgot-password"], csrfProtection, attachCsrfToken, authController.forgotPasswordForm);
router.post(["/forgot-password", "/super-admin/forgot-password"], authLimiter, csrfProtection, attachCsrfToken, authController.forgotPassword);
router.get(["/reset-password/:token", "/super-admin/reset-password/:token"], csrfProtection, attachCsrfToken, authController.resetPasswordForm);
router.post(["/reset-password/:token", "/super-admin/reset-password/:token"], authLimiter, csrfProtection, attachCsrfToken, authController.resetPassword);

router.get("/super-admin/platform-users", platformAdminOnly, csrfProtection, attachCsrfToken, authController.listPlatformUsers);
router.get("/super-admin/platform-users/create", platformAdminOnly, csrfProtection, attachCsrfToken, authController.createPlatformUserForm);
router.post("/super-admin/platform-users/create", platformAdminOnly, csrfProtection, attachCsrfToken, authController.createPlatformUser);
router.post("/super-admin/platform-users/:id/status", platformAdminOnly, csrfProtection, attachCsrfToken, authController.updatePlatformUserStatus);
router.post("/super-admin/platform-users/:id/role", platformAdminOnly, csrfProtection, attachCsrfToken, authController.updatePlatformUserRole);

module.exports = router;
