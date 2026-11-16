import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";
import { ID_RE, json } from "../lib/common.mjs";
import { sendMail } from "../lib/mail.mjs";

// A visitor asks for a summary of their report by email. In return their first clean report
// (save or print, no watermark) is free. One per email address and one per browser.
const people = () => getStore({ name: "subscribers", consistency: "strong" });
const sha = (s) => createHash("sha256").update(s).digest("hex");
const clip = (v, n) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, n);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const validEmail = (e) => /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(e) && e.length <= 254;
const USED = "This email has already had its free report. A Homebuyer Pass is $14.99 for 25 reports over 30 days.";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: "bad request" }, 400); }
  if (b.website) return json({ ok: true }); // bots fill the hidden field
  const id = String(b.id || ""), email = String(b.email || "").trim().toLowerCase();
  if (!ID_RE.test(id)) return json({ error: "bad request" }, 400);
  if (!validEmail(email)) return json({ error: "Please enter a valid email." }, 400);
  if (b.consent !== true) return json({ error: "Please tick the box so we know it is OK to email you." }, 400);

  const s = people();
  const hour = new Date().toISOString().slice(0, 13);
  const ip = req.headers.get("x-nf-client-connection-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "x";
  const rk = "rl:" + sha(ip + "|vk").slice(0, 16) + ":" + hour, seen = Number((await s.get(rk)) || 0);
  if (seen >= 5) return json({ error: "Too many requests right now. Please try again later." }, 429);

  const byEmail = await s.get("sub:" + email, { type: "json" }), byVid = await s.get("vid:" + id, { type: "json" });
  if (byEmail && byEmail.id === id) return json({ ok: true }); // same browser asking twice: already granted
  if (byEmail || byVid) return json({ error: USED }, 409);
  await s.set(rk, String(seen + 1));

  const at = new Date().toISOString(), kind = b.kind === "aff" ? "affordability" : "payment";
  await s.setJSON("sub:" + email, { email, id, at, kind, updates: true, consent: "Asked for a report summary by email and agreed to occasional Voklogik updates" });
  await s.setJSON("vid:" + id, { email, at });

  // The summary rows come from the visitor's browser, so keep them short and free of links.
  const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 80)
    .map((r) => (Array.isArray(r) ? [clip(r[0], 80), clip(r[1], 100)] : null))
    .filter((r) => r && (r[0] || r[1]) && !/https?:|www\.|\/\//i.test(r[0] + " " + r[1]));
  const body = rows.map(([k, v]) => (k.startsWith("## ") ? "\n" + k.slice(3).toUpperCase() : `  ${k}${v ? ": " + v : ""}`));
  const site = process.env.SITE_URL || "https://voklogik.com";
  const lines = [
    "Here is the summary of the report you ran on Voklogik.", "",
    ...(body.length ? body : ["  (No figures were entered yet.)"]), "",
    "Your first clean report is unlocked in the browser you used. Save or print it there, without the watermark.",
    "This is an estimate for planning only. It is built from what you entered and is not verified. It is not a loan offer, approval or commitment.", "",
    `Run your numbers again any time: ${site}`, "",
    "You are getting this because you asked for it at voklogik.com. We may send you occasional Voklogik updates. To stop them, reply to this email with the word unsubscribe.",
  ];
  try {
    await sendMail({ to: email, bcc: process.env.LEADS_BCC || process.env.SMTP_USER, subject: "Your Voklogik report summary", text: lines.join("\n"),
      html: "<p>" + lines.join("\n").split("\n").map((l) => esc(l)).join("<br>") + "</p>" });
  } catch (e) { console.error("summary email failed", e.message); } // the free report is still granted
  return json({ ok: true });
};
