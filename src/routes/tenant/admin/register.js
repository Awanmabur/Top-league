// src/routes/tenant/register.js
const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/admin/registerController");

// STUDENT REGISTRATION (SELF-SERVICE)
router.get("/register/student", ctrl.studentRegisterPage);
router.post("/register/student", ctrl.studentRegister);

// STAFF REGISTRATION (SELF-SERVICE)
router.get("/register/staff", ctrl.staffRegisterPage);
router.post("/register/staff", ctrl.staffRegister);

module.exports = router;
