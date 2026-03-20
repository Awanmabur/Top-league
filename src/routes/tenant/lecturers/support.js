const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/lecturers/supportController");

// Support tickets (optional but recommended)
router.get("/support", ctrl.list);
router.get("/support/new", ctrl.newForm);
router.post("/support", ctrl.create);
router.get("/support/:id", ctrl.view);
router.post("/support/:id/reply", ctrl.reply);

module.exports = router;
