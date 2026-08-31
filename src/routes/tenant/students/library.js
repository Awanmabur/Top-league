const express = require("express");
const router = express.Router();
const libraryController = require("../../../controllers/tenant/students/libraryController");

router.get("/library", libraryController.library);
router.post("/library/books/:bookId/reserve", libraryController.reserve);
router.post("/library/loans/:loanId/renew", libraryController.renew);

module.exports = router;
