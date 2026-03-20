const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/parents/childrenController");

router.get("/children", ctrl.list);

module.exports = router;
