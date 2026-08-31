const express = require("express");
const router = express.Router();
const hostelController = require("../../../controllers/tenant/students/hostelController");

router.get("/hostel", hostelController.hostel);
router.post("/hostel/apply", hostelController.apply);

module.exports = router;
