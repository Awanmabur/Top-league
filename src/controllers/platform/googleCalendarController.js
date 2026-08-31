const AuditLog = require("../../models/platform/AuditLog")(require("../../config/db").platformConnection);
const googleCalendar = require("../../services/googleCalendarAuthService");

async function audit(req, action, description, meta = {}) {
  try {
    await AuditLog.create({
      actorId: req.user?._id || null,
      actorName: req.user?.name || "",
      actorRole: req.user?.role || "",
      action,
      entityType: "PlatformIntegrationCredential",
      entityId: googleCalendar.PROVIDER,
      description,
      ipAddress: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      meta,
    });
  } catch (error) {
    console.error("Google Calendar audit log failed:", error?.message || error);
  }
}

function clearPending(req) {
  if (!req.session) return;
  delete req.session.googleCalendarOauthState;
  delete req.session.googleCalendarOauthVerifier;
  delete req.session.googleCalendarOauthExpiresAt;
}

module.exports = {
  connect: async (req, res) => {
    try {
      if (googleCalendar.authMode() !== "oauth") {
        req.flash?.("error", "Google Calendar uses service-account authentication in this deployment. Test the configured connection instead of starting OAuth.");
        return res.redirect("/super-admin/settings");
      }
      if (!googleCalendar.oauthConfigured()) {
        req.flash?.("error", "Configure GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REDIRECT_URI first.");
        return res.redirect("/super-admin/settings");
      }
      const pending = googleCalendar.createAuthorizationState();
      req.session.googleCalendarOauthState = pending.state;
      req.session.googleCalendarOauthVerifier = pending.verifier;
      req.session.googleCalendarOauthExpiresAt = pending.expiresAt;
      return res.redirect(googleCalendar.authorizationUrl(pending));
    } catch (error) {
      clearPending(req);
      req.flash?.("error", error?.message || "Google Calendar connection could not start.");
      return res.redirect("/super-admin/settings");
    }
  },

  callback: async (req, res) => {
    try {
      if (googleCalendar.authMode() !== "oauth") throw new Error("OAuth callback is disabled while Google Calendar uses service-account authentication.");
      if (req.query.error) throw new Error("Google authorization was denied or cancelled.");
      const expected = req.session?.googleCalendarOauthState;
      const verifier = req.session?.googleCalendarOauthVerifier;
      const expiresAt = Number(req.session?.googleCalendarOauthExpiresAt || 0);
      if (!expected || !verifier || !expiresAt || Date.now() > expiresAt) {
        throw new Error("Google authorization session expired. Start the connection again.");
      }
      if (!googleCalendar.safeStateEqual(req.query.state, expected)) {
        throw new Error("Google authorization state did not match.");
      }

      await googleCalendar.completeAuthorization({
        code: req.query.code,
        verifier,
        actorId: req.user?._id || null,
      });
      clearPending(req);
      await audit(req, "Connect Google Calendar", "Connected the production booking calendar using OAuth 2.0.");
      req.flash?.("success", "Google Calendar connected and verified successfully.");
      return res.redirect("/super-admin/settings");
    } catch (error) {
      clearPending(req);
      console.error("Google Calendar OAuth callback:", error?.message || error);
      req.flash?.("error", error?.message || "Google Calendar authorization failed.");
      return res.redirect("/super-admin/settings");
    }
  },

  test: async (req, res) => {
    try {
      await googleCalendar.testConnection();
      await audit(req, "Test Google Calendar", "Verified Google Calendar authorization and free/busy access.");
      req.flash?.("success", "Google Calendar connection is healthy.");
    } catch (error) {
      console.error("Google Calendar test:", error?.message || error);
      req.flash?.("error", error?.code === "GOOGLE_CALENDAR_RECONNECT_REQUIRED"
        ? "Google Calendar authorization is no longer valid. Reconnect it."
        : error?.code === "GOOGLE_CALENDAR_SERVICE_ACCOUNT_ERROR"
          ? "Google Calendar service-account authentication failed. Check domain-wide delegation, the impersonated user, and calendar access."
          : "Google Calendar connection test failed.");
    }
    return res.redirect("/super-admin/settings");
  },

  disconnect: async (req, res) => {
    try {
      if (googleCalendar.authMode() === "service_account") {
        req.flash?.("error", "Service-account credentials are managed in the deployment environment. Rotate or remove them there instead.");
        return res.redirect("/super-admin/settings");
      }
      await googleCalendar.disconnect({ actorId: req.user?._id || null });
      await audit(req, "Disconnect Google Calendar", "Removed the stored Google Calendar refresh credential.");
      req.flash?.("success", "Google Calendar disconnected.");
    } catch (error) {
      req.flash?.("error", error?.message || "Google Calendar could not be disconnected.");
    }
    return res.redirect("/super-admin/settings");
  },
};
