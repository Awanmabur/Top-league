const express = require("express");
const router = express.Router();

const supportController = require("../../../controllers/tenant/parents/supportController");

router.get("/support", supportController.index);
router.post("/support", supportController.store);
router.post("/support/:id/reply", supportController.reply);

module.exports = router;