import { store, getAccount, saveAccount, getImages, validEmail, normEmail, clip, linkTier, findPartner, usage, TOPAZ_REPORTS, HANDLE_RE, sha256, countStat } from "../lib/topaz.mjs";
import { sendMail } from "../lib/mail.mjs";
import { checkMismo } from "../lib/mismo-check.mjs";
import { json } from "../lib/common.mjs";

// Public endpoints for a member's client link (/w/<handle>).
//   GET  /api/widget/profile?h=<handle>[&p=<partner>]   the member's public branding (and an Opal partner's)
//   POST /api/widget/lead   Opal: a visitor asks the member to follow up (saved as a lead)
//   POST /api/widget/pdf    Topaz: a client emails the member a PDF summary (never saved)
export const config = { path: "/api/widget/*" };

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 100) / 100 : null; };
const body = async (req) => { try { return await req.json(); } catch { return {}; } };

// Find the member behind a page name; nothing is revealed unless the link is switched on and the plan is active.
async function findMember(h) {
  h = String(h || "").trim().toLowerCase();
  if (!HANDLE_RE.test(h)) return null;
  const id = await store().get("handle:" + h);
  if (!id) return null;
  const a = await getAccount(id);
  if (!a || !a.widget?.enabled || a.widget.handle !== h || !linkTier(a)) return null;
  return a;
}

export default async (req) => {
  const action = new URL(req.url).pathname.split("/").pop();
  const s = store();

  if (action === "profile" && req.method === "GET") {
    const a = await findMember(new URL(req.url).searchParams.get("h"));
    if (!a) return json({ error: "not found" }, 404);
    const b = a.brand || {}, imgs = await getImages(a.id), tier = linkTier(a);
    const pt = tier === "opal" ? findPartner(a, new URL(req.url).searchParams.get("p")) : null;
    return json({
      ok: true, tier,
      intro: tier === "opal" ? a.widget.intro || "" : "",
      partner: pt ? { id: pt.id, name: pt.name, company: pt.company || "", phone: pt.phone || "", full: !!pt.full } : null,
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
    if (!a || linkTier(a) !== "opal") return json({ ok: true });
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
    if (!a || linkTier(a) !== "opal") return json({ error: "This page is not available." }, 404);
    const pt = findPartner(a, b.p);

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
    // Optional loan system file (MISMO 3.4) built in the visitor's browser. It is checked strictly, only emailed
    // (never stored), and if the check fails the lead still goes out without it.
    let attach = null;
    if (typeof b.mismo === "string" && b.mismo) {
      const v = checkMismo(b.mismo);
      if (v.ok) attach = [{ filename: "voklogik-scenario-mismo34.xml", content: b.mismo, contentType: "application/xml" }];
      else console.error("lead file rejected:", v.reason);
    }
    const hasScenario = Object.values(scenario).some((v) => v != null);
    const at = new Date().toISOString();
    const lead = { at, name, email, phone, message, scenario, affordability: aff, kind: aff.length ? "affordability" : "payment", consent: "Agreed to be contacted by the member" + (pt ? ", " + pt.name : "") + " and Voklogik about this estimate", handle: a.widget.handle, ...(pt ? { partner: { id: pt.id, name: pt.name } } : {}) };
    await s.setJSON("lead:" + a.id + ":" + at + ":" + sha256(email + at + Math.random()).slice(0, 6), lead);
    try { await countStat(a.id, "lead"); } catch {}

    // Tell the member, with Voklogik copied on the same message.
    const to = a.widget.notify || a.brand?.email || a.email;
    const money = (n) => (n == null ? "n/a" : "$" + Math.round(n).toLocaleString("en-US"));
    const affLines = aff.length
      ? ["Affordability summary they ran (planning only):", ...aff.map(([k, v]) => (k.startsWith("## ") ? "\n" + k.slice(3).toUpperCase() : `  ${k}: ${v}`)), ""]
      : [];
    const lines = [
      `Name: ${name}`, `Email: ${email}`, phone ? `Phone: ${phone}` : null, message ? `Message: ${message}` : null,
      pt ? `Came through your partner: ${pt.name}${pt.company ? ", " + pt.company : ""}` : null, "",
      ...(hasScenario ? [
        "Estimate they ran (planning only):",
        `  Home price: ${money(scenario.price)}`, `  Down payment: ${scenario.downPct ?? "n/a"}%`,
        `  Rate: ${scenario.rate ?? "n/a"}%`, `  Term: ${scenario.years ?? "n/a"} years`, `  Estimated monthly payment: ${money(scenario.payment)}`, "",
      ] : []),
      ...affLines,
      ...(attach ? ["A loan system file (MISMO 3.4, XML) is attached. Import it into your loan origination system, then add their SSN and date of birth and pull credit. It was built from what they entered and is not verified.", ""] : []),
      `They agreed on ${at.slice(0, 10)} to be contacted by you${pt ? ", " + pt.name : ""} and Voklogik about this estimate.`,
      "This is a planning estimate, not a loan application. Reply to this email to answer them directly.",
    ].filter((x) => x !== null);
    const html = "<p>" + lines.join("\n").split("\n").map((l) => esc(l)).join("<br>") + "</p>";
    try {
      await sendMail({ to, bcc: process.env.LEADS_BCC || process.env.SMTP_USER, replyTo: email, subject: `New lead from your Voklogik page: ${name}`, text: lines.join("\n"), html, attachments: attach });
    } catch (e) { console.error("lead email failed", e.message); }
    // The partner hears about it too. Unless the member chose to share the full file with them, they get the
    // contact details and the headline estimate only: no income, debts or assets, and no loan system file.
    if (pt && validEmail(pt.email)) {
      const who = a.brand?.name || a.brand?.company || "your Voklogik partner";
      const pl = pt.full ? [`This came through your link with ${who}.`, "", ...lines] : [
        `Someone used your link with ${who} and asked for a follow-up.`, "",
        `Name: ${name}`, `Email: ${email}`, phone ? `Phone: ${phone}` : null, message ? `Message: ${message}` : null, "",
        ...(scenario.price != null ? [`Home price they looked at: ${money(scenario.price)}`] : []),
        ...(scenario.payment != null ? [`Estimated monthly payment: ${money(scenario.payment)}`] : []),
        "", `${who} received their full summary.`,
        `They agreed on ${at.slice(0, 10)} to be contacted by ${who}, you and Voklogik about this estimate.`,
        "This is a planning estimate, not a loan application.",
      ].filter((x) => x !== null);
      try {
        await sendMail({ to: pt.email, replyTo: email, subject: `New lead from your Voklogik link: ${name}`, text: pl.join("\n"),
          html: "<p>" + pl.join("\n").split("\n").map((l) => esc(l)).join("<br>") + "</p>", attachments: pt.full ? attach : null });
      } catch (e) { console.error("partner email failed", e.message); }
    }
    return json({ ok: true });
  }

  // Topaz client link: the client's browser builds the branded PDF and it is emailed to the member.
  // It counts as one of the member's reports for the period. Nothing is saved and Voklogik is not copied.
  if (action === "pdf" && req.method === "POST") {
    const b = await body(req);
    if (b.website) return json({ ok: true });
    const a = await findMember(b.h);
    if (!a || linkTier(a) !== "topaz") return json({ error: "This page is not available." }, 404);
    const name = clip(b.name, 80), email = normEmail(b.email), phone = clip(b.phone, 30).replace(/[^0-9+()\-. x]/gi, "");
    const message = clip(b.message, 500);
    if (!name) return json({ error: "Please add your name." }, 400);
    if (!validEmail(email)) return json({ error: "Please enter a valid email." }, 400);
    if (b.consent !== true) return json({ error: "Please tick the box so we know it is OK to contact you." }, 400);
    // The file must be a plain PDF of a sensible size, with nothing active inside it.
    const b64 = typeof b.pdf === "string" ? b.pdf : "";
    if (b64.length < 400 || b64.length > 3000000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return json({ error: "The summary could not be attached. Please try again." }, 400);
    const pdf = Buffer.from(b64, "base64"), raw = pdf.toString("latin1");
    // Image and page data (the streams) is skipped so its random bytes can not look like a keyword.
    const skel = raw.replace(/stream\r?\n[\s\S]*?endstream/g, "");
    if (!raw.startsWith("%PDF-") || raw.lastIndexOf("%%EOF") < raw.length - 1024 || /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|SubmitForm|ImportData|GoToR|GoToE)\b/.test(skel))
      return json({ error: "The summary could not be attached. Please try again." }, 400);

    const hour = new Date().toISOString().slice(0, 13);
    const ip = req.headers.get("x-nf-client-connection-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "x";
    const hk = "rl:" + sha256(ip + "|vk").slice(0, 16) + ":" + a.id + ":" + hour, pk = "rlp:" + a.id + ":" + hour;
    const mine = Number((await s.get(hk)) || 0), all = Number((await s.get(pk)) || 0);
    if (mine >= 3 || all >= 20) return json({ error: "Too many requests right now. Please try again later." }, 429);

    const who = a.brand?.name || a.brand?.company || "This professional";
    const u = usage(a);
    if (u.limit != null && u.used >= u.limit) return json({ error: `${who} has reached this month's limit for this page. Please contact them directly.` }, 402);
    await s.set(hk, String(mine + 1)); await s.set(pk, String(all + 1));
    a.usedKey = u.key; a.used = u.used + 1;
    await saveAccount(a);

    const at = new Date().toISOString(), to = a.widget.notify || a.brand?.email || a.email;
    const lines = [
      "A client completed the Affordability check on your Voklogik link. Their summary is attached as a PDF.", "",
      `Name: ${name}`, `Email: ${email}`, phone ? `Phone: ${phone}` : null, message ? `Message: ${message}` : null, "",
      "The summary was built from what they entered and is not verified.",
      `They agreed on ${at.slice(0, 10)} to be contacted by you about this summary.`,
      "This is a planning estimate, not a loan application. Reply to this email to answer them directly.", "",
      `This used 1 of your ${TOPAZ_REPORTS} Topaz reports for the period (${a.used} used). Voklogik does not keep a copy of the PDF.`,
    ].filter((x) => x !== null);
    try {
      await sendMail({ to, replyTo: email, subject: `Affordability summary from ${name}`, text: lines.join("\n"),
        html: "<p>" + lines.join("\n").split("\n").map((l) => esc(l)).join("<br>") + "</p>",
        attachments: [{ filename: "voklogik-affordability-" + (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "client") + ".pdf", content: pdf, contentType: "application/pdf" }] });
    } catch (e) {
      console.error("pdf email failed", e.message);
      const cur = await getAccount(a.id); // hand the report back: it never reached the member
      if (cur && cur.usedKey === u.key && cur.used > 0) { cur.used -= 1; await saveAccount(cur); }
      return json({ error: "Could not send right now. Please try again in a moment." }, 502);
    }
    return json({ ok: true });
  }

  return json({ error: "not found" }, 404);
};
