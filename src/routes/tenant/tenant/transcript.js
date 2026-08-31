const express = require("express");
const router = express.Router();

const ctrl = require("../../../controllers/tenant/admin/transcriptsController");
const letterCtrl = require("../../../controllers/tenant/public/letterVerificationController");

router.get("/verify/transcript/:issueNumber", ctrl.verifyPage);
router.get("/api/verify/transcript/:issueNumber", ctrl.verifyApi);
router.get("/verify/letter/:requestNumber", letterCtrl.page);
router.get("/api/verify/letter/:requestNumber", letterCtrl.api);

module.exports = router;
