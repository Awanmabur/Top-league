// src/utils/emailTemplates.js

function setupPasswordEmail({ appName, firstName, inviteLink }) {
  const name = String(firstName || "").trim() || "there";
  const title = String(appName || "Classic Academy");

  return `
  <div style="font-family:Arial,sans-serif;line-height:1.55;color:#111">
    <h2 style="margin:0 0 12px 0">${title} — Set your password</h2>
    <p style="margin:0 0 12px 0">Hello ${name},</p>
    <p style="margin:0 0 12px 0">
      Your account has been created. Click the button below to set your password:
    </p>
    <p style="margin:18px 0">
      <a href="${inviteLink}"
         style="display:inline-block;padding:12px 16px;background:#0b5cff;color:#fff;text-decoration:none;border-radius:8px">
        Set Password
      </a>
    </p>
    <p style="margin:0 0 12px 0;color:#444">
      This link expires in 24 hours. If it expires, ask the admin to resend a new link.
    </p>
    <hr style="border:none;border-top:1px solid #eee;margin:18px 0" />
    <p style="margin:0;color:#777;font-size:12px">
      If you did not request this, you can safely ignore this email.
    </p>
  </div>`;
}

module.exports = { setupPasswordEmail };
