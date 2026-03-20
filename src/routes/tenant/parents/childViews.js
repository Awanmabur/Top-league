const express = require("express");
const router = express.Router();

const childViewsController = require("../../../controllers/tenant/parents/childViewsController");

router.get("/children/:id", childViewsController.show);

module.exports = router;