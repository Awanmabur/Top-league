const express = require("express");
const router = express.Router();
const hostelController = require("../../../controllers/tenant/students/hostelController");

router.get("/hostel", hostelController.hostel);

module.exports = router;