import nodemailer from "nodemailer";

// SMTP sender. Works with Zoho or Amazon SES, chosen only by Netlify variables:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS  (SES: email-smtp.us-east-2.amazonaws.com, 465, SES SMTP username/password)
//   MAIL_FROM  the visible From address (default: SMTP_USER, which is how Zoho worked). Needed for SES,
//              because the SES SMTP username is a key, not an email address.
//   LEADS_BCC  optional copy address for lead mail (default: MAIL_FROM, then SMTP_USER).
export const fromAddress = () => process.env.MAIL_FROM || process.env.SMTP_USER;
export const bccDefault = () => process.env.LEADS_BCC || fromAddress();
export async function sendMail({ to, subject, text, html, bcc, replyTo, attachments }) {
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!user || !pass) throw new Error("SMTP not configured");
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.zoho.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    auth: { user, pass },
  });
  await t.sendMail({ from: `Voklogik <${fromAddress()}>`, headers: { "List-Unsubscribe": `<mailto:${fromAddress()}?subject=unsubscribe>` }, to, subject, text, html, ...(bcc ? { bcc } : {}), ...(replyTo ? { replyTo } : {}), ...(attachments && attachments.length ? { attachments } : {}) });
}
