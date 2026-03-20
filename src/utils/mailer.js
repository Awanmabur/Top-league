// src/utils/mailer.js
const nodemailer = require("nodemailer");

function getTransport() {
  const host = process.env.SMTP_HOST || "";
  const port = parseInt(process.env.SMTP_PORT || "2525", 10);
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";

  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 2525/587 are typically STARTTLS (secure=false)
    auth: { user, pass },
  });
}

async function sendMail({ to, subject, html, text }) {
  const transport = getTransport();
  if (!transport) {
    throw new Error(
      "SMTP not configured. Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS.",
    );
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  // Optional but helpful during setup
  if (process.env.NODE_ENV !== "production") {
    await transport.verify();
  }

  return transport.sendMail({
    from,
    to,
    subject,
    ...(text ? { text } : {}),
    ...(html ? { html } : {}),
  });
}

module.exports = { sendMail };
