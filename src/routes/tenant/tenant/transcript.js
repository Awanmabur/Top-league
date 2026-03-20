const express = require("express");
const router = express.Router();

const ctrl = require("../../../controllers/tenant/admin/transcriptsController");

router.get("/verify/transcript/:issueNumber", ctrl.verifyPage);
router.get("/api/verify/transcript/:issueNumber", ctrl.verifyApi);

module.exports = router;
