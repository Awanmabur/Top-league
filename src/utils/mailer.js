// src/utils/mailer.js
const nodemailer = require("nodemailer");

const singleLine = (value, max = 320) => String(value ?? "").replace(/[\r\n\u2028\u2029]+/g, " ").trim().slice(0, max);
const mailBody = (value, max) => String(value ?? "").slice(0, max);

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
    // Email bodies are application strings, never file/URL-backed Nodemailer content objects.
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

async function sendMail({ to, subject, html, text, replyTo, fromName }) {
  const transport = getTransport();
  if (!transport) {
    throw new Error(
      "SMTP not configured. Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS.",
    );
  }

  const from = singleLine(process.env.SMTP_FROM || process.env.SMTP_USER, 320);
  const cleanTo = singleLine(to, 1000);
  const cleanSubject = singleLine(subject, 300);
  const cleanReplyTo = replyTo ? singleLine(replyTo, 320) : "";
  const cleanFromName = fromName ? singleLine(fromName, 180) : "";
  if (!cleanTo) throw new Error("Email recipient is required.");

  // Optional but helpful during setup
  if (process.env.NODE_ENV !== "production") {
    await transport.verify();
  }

  return transport.sendMail({
    from: cleanFromName ? { name: cleanFromName, address: from } : from,
    ...(cleanReplyTo ? { replyTo: cleanReplyTo } : {}),
    to: cleanTo,
    subject: cleanSubject,
    ...(text != null && text !== "" ? { text: mailBody(text, 1_000_000) } : {}),
    ...(html != null && html !== "" ? { html: mailBody(html, 2_000_000) } : {}),
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

module.exports = { sendMail, _test: { singleLine, mailBody } };
