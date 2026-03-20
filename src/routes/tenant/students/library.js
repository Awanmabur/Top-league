const express = require("express");
const router = express.Router();
const libraryController = require("../../../controllers/tenant/students/libraryController");

router.get("/library", libraryController.library);

module.exports = router;