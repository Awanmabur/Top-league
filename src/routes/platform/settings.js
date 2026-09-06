const express = require("express");
const router = express.Router();
const settingsController = require("../../controllers/platform/settingsController");
const googleCalendarController = require("../../controllers/platform/googleCalendarController");
const { platformRequire } = require("../../middleware/platform/guards");
const { csrfProtection, attachCsrfToken } = require("../../middleware/tenant/csrf");

router.use(csrfProtection, attachCsrfToken);
router.get("/super-admin/settings", platformRequire("settings.view"), settingsController.settingsPage);
router.post("/super-admin/settings/general", platformRequire("settings.manage"), settingsController.updateGeneralSettings);
router.post("/super-admin/settings/branding", platformRequire("settings.manage"), settingsController.updateBrandingSettings);
router.post("/super-admin/settings/security", platformRequire("settings.manage"), settingsController.updateSecuritySettings);
router.get("/super-admin/settings/google-calendar/connect", platformRequire("settings.manage"), googleCalendarController.connect);
router.get("/super-admin/settings/google-calendar/callback", platformRequire("settings.manage"), googleCalendarController.callback);
router.post("/super-admin/settings/google-calendar/test", platformRequire("settings.manage"), googleCalendarController.test);
router.post("/super-admin/settings/google-calendar/disconnect", platformRequire("settings.manage"), googleCalendarController.disconnect);

module.exports = router;
