const express = require("express");
const router = express.Router();
const settingsController = require("../../controllers/platform/settingsController");

router.get("/super-admin/settings", settingsController.settingsPage);
router.post("/super-admin/settings/general", settingsController.updateGeneralSettings);
router.post("/super-admin/settings/branding", settingsController.updateBrandingSettings);
router.post("/super-admin/settings/security", settingsController.updateSecuritySettings);

module.exports = router;