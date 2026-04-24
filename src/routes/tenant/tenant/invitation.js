// routes/tenant/auth/setPassword.routes.js
const express = require("express");
const router = express.Router();
const authCtrl = require("../../../controllers/tenant/tenant/inviteAuthController");
const { csrfProtection, attachCsrfToken } = require("../../../middleware/tenant/csrf");

// Public (no login required)
router.get("/set-password", csrfProtection, attachCsrfToken, authCtrl.setPasswordForm);

router.post("/set-password", csrfProtection, attachCsrfToken, authCtrl.setPasswordSubmit);

module.exports = router;
