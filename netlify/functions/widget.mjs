import { store, getAccount, getImages, validEmail, normEmail, clip, opalOk, HANDLE_RE, sha256, countStat } from "../lib/topaz.mjs";
import { sendMail } from "../lib/mail.mjs";
import { json } from "../lib/common.mjs";

// Public endpoints for the Opal co-branded widget page (/w/<handle>).
//   GET  /api/widget/profile?h=<handle>   the member's public branding
//   POST /api/widget/lead                 a visitor asks the member to follow up
export const config = { path: "/api/widget/*" };

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 100) / 100 : null; };
const body = async (req) => { try { return await req.json(); } catch { return {}; } };

// Find the member behind a page name; nothing is revealed unless the widget is switched on and Opal is active.
async function findMember(h) {
  h = String(h || "").trim().toLowerCase();
  if (!HANDLE_RE.test(h)) return null;
  const id = await store().get("handle:" + h);
  if (!id) return null;
  const a = await getAccount(id);
  if (!a || !a.widget?.enabled || a.widget.handle !== h || !opalOk(a)) return null;
  return a;
}

export default async (req) => {
  const action = new URL(req.url).pathname.split("/").pop();
  const s = store();

  if (action === "profile" && req.method === "GET") {
    const a = await findMember(new URL(req.url).searchParams.get("h"));
    if (!a) return json({ error: "not found" }, 404);
    const b = a.brand || {}, imgs = await getImages(a.id);
    return json({
      ok: true,
      intro: a.widget.intro || "",
      brand: { name: b.name || "", company: b.company || "", title: b.title || "", phone: b.phone || "", email: b.email || "",
        website: b.website || "", mls: b.mls || "", nmls: b.nmls || "", logo: imgs.logo || null, headshot: imgs.headshot || null },
    });
  }

  // Plain activity counts for the member's dashboard. Nothing about the visitor is stored.
  if (action === "event" && req.method === "POST") {
    const b = await body(req);
    const e = String(b.e || "");
    if (!["view", "estimate", "aff"].includes(e)) return json({ ok: true });
    if (/bot|crawl|spider|slurp|preview|headless|facebookexternalhit|monitor/i.test(req.headers.get("user-agent") || "")) return json({ ok: true });
    const a = await findMember(b.h);
    if (!a) return json({ ok: true });
    const hour = new Date().toISOString().slice(0, 13);
    const ip = req.headers.get("x-nf-client-connection-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "x";
    const ek = "rle:" + sha256(ip + "|vk").slice(0, 16) + ":" + a.id + ":" + hour;
    const seen = Number((await s.get(ek)) || 0);
    if (seen >= 30) return json({ ok: true });
    await s.set(ek, String(seen + 1));
    await countStat(a.id, e);
    return json({ ok: true });
  }

  if (action === "lead" && req.method === "POST") {
    const b = await body(req);
    // Bots fill the hidden field. Pretend it worked.
    if (b.website) return json({ ok: true });
    const a = await findMember(b.h);
    if (!a) return json({ error: "This page is not available." }, 404);

    const name = clip(b.name, 80), email = normEmail(b.email), phone = clip(b.phone, 30).replace(/[^0-9+()\-. x]/gi, "");
    const message = clip(b.message, 500);
    if (!name) return json({ error: "Please add your name." }, 400);
    if (!validEmail(email)) return json({ error: "Please enter a valid email." }, 400);
    if (b.consent !== true) return json({ error: "Please tick the box so we know it is OK to contact you." }, 400);

    // Light rate limits: 3 sends per visitor and 20 per page, per hour.
    const hour = new Date().toISOString().slice(0, 13);
    const ip = req.headers.get("x-nf-client-connection-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "x";
    const hk = "rl:" + sha256(ip + "|vk").slice(0, 16) + ":" + a.id + ":" + hour, pk = "rlp:" + a.id + ":" + hour;
    const mine = Number((await s.get(hk)) || 0), all = Number((await s.get(pk)) || 0);
    if (mine >= 3 || all >= 20) return json({ error: "Too many requests right now. Please try again later." }, 429);
    await s.set(hk, String(mine + 1)); await s.set(pk, String(all + 1));

    const sc = b.scenario || {};
    const scenario = {
      price: num(sc.price, 0, 1e9), downPct: num(sc.downPct, 0, 100), rate: num(sc.rate, 0, 30),
      years: num(sc.years, 1, 50), payment: num(sc.payment, 0, 1e7),
    };
    // Optional: the Affordability summary rows the visitor chose to send ([label, value] pairs).
    const aff = Array.isArray(b.affordability)
      ? b.affordability.slice(0, 80).map((r) => (Array.isArray(r) ? [clip(r[0], 80), clip(r[1], 100)] : null)).filter((r) => r && (r[0] || r[1]))
      : [];
    const hasScenario = Object.values(scenario).some((v) => v != null);
    const at = new Date().toISOString();
    const lead = { at, name, email, phone, message, scenario, affordability: aff, kind: aff.length ? "affordability" : "payment", consent: "Agreed to be contacted by the member and Voklogik about this estimate", handle: a.widget.handle };
    await s.setJSON("lead:" + a.id + ":" + at + ":" + sha256(email + at + Math.random()).slice(0, 6), lead);
    try { await countStat(a.id, "lead"); } catch {}

    // Tell the member, with Voklogik copied on the same message.
    const to = a.widget.notify || a.brand?.email || a.email;
    const money = (n) => (n == null ? "n/a" : "$" + Math.round(n).toLocaleString("en-US"));
    const affLines = aff.length
      ? ["Affordability summary they ran (planning only):", ...aff.map(([k, v]) => (k.startsWith("## ") ? "\n" + k.slice(3).toUpperCase() : `  ${k}: ${v}`)), ""]
      : [];
    const lines = [
      `Name: ${name}`, `Email: ${email}`, phone ? `Phone: ${phone}` : null, message ? `Message: ${message}` : null, "",
      ...(hasScenario ? [
        "Estimate they ran (planning only):",
        `  Home price: ${money(scenario.price)}`, `  Down payment: ${scenario.downPct ?? "n/a"}%`,
        `  Rate: ${scenario.rate ?? "n/a"}%`, `  Term: ${scenario.years ?? "n/a"} years`, `  Estimated monthly payment: ${money(scenario.payment)}`, "",
      ] : []),
      ...affLines,
      `They agreed on ${at.slice(0, 10)} to be contacted by you and Voklogik about this estimate.`,
      "This is a planning estimate, not a loan application. Reply to this email to answer them directly.",
    ].filter((x) => x !== null);
    const html = "<p>" + lines.join("\n").split("\n").map((l) => esc(l)).join("<br>") + "</p>";
    try {
      await sendMail({ to, bcc: process.env.LEADS_BCC || process.env.SMTP_USER, replyTo: email, subject: `New lead from your Voklogik page: ${name}`, text: lines.join("\n"), html });
    } catch (e) { console.error("lead email failed", e.message); }
    return json({ ok: true });
  }

  return json({ error: "not found" }, 404);
};
