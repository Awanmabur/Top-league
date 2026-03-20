const express = require("express");
const router = express.Router();
const supportController = require("../../../controllers/tenant/students/supportController");

router.get("/support", supportController.support);

module.exports = router;