// routes/tenant/auth/setPassword.routes.js
const express = require("express");
const router = express.Router();
const authCtrl = require("../../../controllers/tenant/tenant/inviteAuthController");

// Public (no login required)
router.get("/set-password", authCtrl.setPasswordForm);

router.post("/set-password", authCtrl.setPasswordSubmit);

module.exports = router;
