// src/routes/tenant/auth.js
const express = require("express");
const router = express.Router();

const AuthController = require("../../../controllers/tenant/tenant/authController");

/* ==========================================
   TENANT AUTH ROUTES
   Works under:  starford.localhost:3000/login
========================================== */

// Login page
router.get("/login", AuthController.loginPage);

// Login submit
router.post("/login", AuthController.login);

// Logout
router.get("/logout", AuthController.logout);

module.exports = router;
