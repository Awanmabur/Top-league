const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/admin/auditlogsController");

router.get("/", ctrl.index);

module.exports = router;