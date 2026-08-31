const express = require("express");
const router = express.Router();
const supportController = require("../../../controllers/tenant/students/supportController");

router.get("/support", supportController.support);
router.post("/support", supportController.create);
router.post("/support/:id/reply", supportController.reply);

module.exports = router;