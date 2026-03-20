const express = require("express");
const router = express.Router();
const authController = require("../../controllers/platform/authController");

router.get("/super-admin/login", authController.loginForm);
router.post("/super-admin/login", authController.login);
router.post("/super-admin/logout", authController.logout);

router.get("/super-admin/forgot-password", authController.forgotPasswordForm);
router.post("/super-admin/forgot-password", authController.forgotPassword);

router.get("/super-admin/reset-password/:token", authController.resetPasswordForm);
router.post("/super-admin/reset-password/:token", authController.resetPassword);

router.get("/super-admin/platform-users/create", authController.createPlatformUserForm);
router.post("/super-admin/platform-users/create", authController.createPlatformUser);

module.exports = router;