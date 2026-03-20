// routes/tenant/auth/setPassword.routes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/admin/setPasswordController");

router.get("/set-password", ctrl.page);
router.post("/set-password", ctrl.submit);

module.exports = router;
