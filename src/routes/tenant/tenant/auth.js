// src/routes/tenant/auth.js
const express = require("express");
const router = express.Router();

const AuthController = require("../../../controllers/tenant/tenant/authController");
const { csrfProtection, attachCsrfToken } = require("../../../middleware/tenant/csrf");
const { authLimiter } = require("../../../middleware/tenant/rateLimiters");

/* ==========================================
   TENANT AUTH ROUTES
   Works under:  starford.localhost:3000/login
========================================== */

// Login page
router.get("/login", csrfProtection, attachCsrfToken, AuthController.loginPage);

// Login submit
router.post("/login", authLimiter, csrfProtection, attachCsrfToken, AuthController.login);

// Logout
router.get("/logout", AuthController.logout);

module.exports = router;
