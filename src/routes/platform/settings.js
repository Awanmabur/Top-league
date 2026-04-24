const express = require("express");
const router = express.Router();
const settingsController = require("../../controllers/platform/settingsController");
const { platformRequire } = require("../../middleware/platform/guards");

router.get("/super-admin/settings", platformRequire("settings.view"), settingsController.settingsPage);
router.post("/super-admin/settings/general", platformRequire("settings.manage"), settingsController.updateGeneralSettings);
router.post("/super-admin/settings/branding", platformRequire("settings.manage"), settingsController.updateBrandingSettings);
router.post("/super-admin/settings/security", platformRequire("settings.manage"), settingsController.updateSecuritySettings);

module.exports = router;
