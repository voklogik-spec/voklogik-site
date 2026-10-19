import nodemailer from "nodemailer";

// Sends from hello@voklogik.com through Zoho SMTP. Set SMTP_USER and SMTP_PASS in Netlify
// (SMTP_PASS should be a Zoho application-specific password).
export async function sendMail({ to, subject, text, html, bcc, replyTo }) {
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!user || !pass) throw new Error("SMTP not configured");
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.zoho.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    auth: { user, pass },
  });
  await t.sendMail({ from: `Voklogik <${user}>`, to, subject, text, html, ...(bcc ? { bcc } : {}), ...(replyTo ? { replyTo } : {}) });
}
