import {
  store, normEmail, validEmail, hashPw, checkPw, newAccountId, startSession, cookieHeader,
  sessionAccountId, endSession, getAccount, saveAccount, getImages, saveImages, isActive, usage,
  publicAccount, cleanImage, cleanBrand, stripeApi, TOPAZ_REPORTS,
  makeResetToken, readResetToken, dropResetToken, RESET_MINUTES,
  clip, previewEmail, opalOk, HANDLE_RE, RESERVED, SITE, readStats, sha256,
} from "../lib/topaz.mjs";
import { sendMail } from "../lib/mail.mjs";
import { json } from "../lib/common.mjs";

export const config = { path: "/api/topaz/*" };

const withCookie = (res, c) => { res.headers.append("set-cookie", c); return res; };
const body = async (req) => { try { return await req.json(); } catch { return {}; } };
const emailKey = (e) => "user:" + e;
// Opal stays off until you set OPAL_LIVE=1 in Netlify, even when the price id is already there.
const opalLive = (a) => !!process.env.OPAL_PRICE_ID && (process.env.OPAL_LIVE === "1" || previewEmail(a?.email));
const withRef = (link, id, email) =>
  link + (link.includes("?") ? "&" : "?") + "client_reference_id=" + id + "&prefilled_email=" + encodeURIComponent(email);

export default async (req) => {
  const action = new URL(req.url).pathname.split("/").pop();
  const s = store();

  if (action === "register" && req.method === "POST") {
    const b = await body(req);
    const email = normEmail(b.email), pw = String(b.password || "");
    if (!validEmail(email)) return json({ error: "Enter a valid email address." }, 400);
    if (pw.length < 10) return json({ error: "Use a password of at least 10 characters." }, 400);
    if (pw.length > 200) return json({ error: "Password is too long." }, 400);
    if (await s.get(emailKey(email))) return json({ error: "That email already has an account. Sign in instead." }, 409);
    const id = newAccountId();
    const { salt, hash } = hashPw(pw);
    await s.setJSON(emailKey(email), { id, salt, hash });
    await saveAccount({
      id, email, plan: "none", status: "none", createdAt: new Date().toISOString(),
      brand: cleanBrand({ name: b.name, email }),
    });
    const { token } = await startSession(id);
    return withCookie(json({ ok: true, account: publicAccount(await getAccount(id), {}) }), cookieHeader(token, 30 * 86400));
  }

  if (action === "login" && req.method === "POST") {
    const b = await body(req);
    const email = normEmail(b.email), pw = String(b.password || "");
    const u = await s.get(emailKey(email), { type: "json" });
    // Same message whether the email exists or not.
    if (!u || pw.length > 200 || !checkPw(pw, u.salt, u.hash)) return json({ error: "Email or password is not right." }, 401);
    const { token } = await startSession(u.id);
    const a = await getAccount(u.id);
    return withCookie(json({ ok: true, account: publicAccount(a, await getImages(u.id)) }), cookieHeader(token, 30 * 86400));
  }

  // Forgot password: always the same answer, so nobody can use this to find out who has an account.
  if (action === "forgot" && req.method === "POST") {
    const email = normEmail((await body(req)).email);
    const same = json({ ok: true });
    if (!validEmail(email)) return same;
    const u = await s.get(emailKey(email), { type: "json" });
    if (!u) return same;
    const lastKey = "resetsent:" + email, last = await s.get(lastKey);
    if (last && Date.now() - Number(last) < 60000) return same; // at most one email a minute
    await s.set(lastKey, String(Date.now()));
    try {
      const site = process.env.SITE_URL || "https://voklogik.com";
      const link = `${site}/topaz.html?reset=${await makeResetToken(u.id, email)}`;
      await sendMail({
        to: email,
        subject: "Reset your Voklogik Topaz password",
        text: `Use this link to choose a new password. It works for ${RESET_MINUTES} minutes and only once.\n\n${link}\n\nIf you did not ask for this, ignore this email and your password stays the same.\n\nVoklogik`,
        html: `<p>Use this link to choose a new password. It works for ${RESET_MINUTES} minutes and only once.</p><p><a href="${link}">Choose a new password</a></p><p style="color:#666">If you did not ask for this, ignore this email and your password stays the same.</p><p>Voklogik</p>`,
      });
    } catch (e) { console.error("reset email failed", e.message); }
    return same;
  }

  if (action === "reset" && req.method === "POST") {
    const b = await body(req), pw = String(b.password || "");
    const r = await readResetToken(b.token);
    if (!r) return json({ error: "This reset link is no longer valid. Ask for a new one." }, 400);
    if (pw.length < 10) return json({ error: "Use a password of at least 10 characters." }, 400);
    if (pw.length > 200) return json({ error: "Password is too long." }, 400);
    const { salt, hash } = hashPw(pw);
    await s.setJSON(emailKey(r.email), { id: r.id, salt, hash });
    const a = await getAccount(r.id);
    if (a) { a.pwChangedAt = new Date().toISOString(); await saveAccount(a); }
    await dropResetToken(b.token);
    return json({ ok: true });
  }

  if (action === "logout") {
    await endSession(req);
    return withCookie(json({ ok: true }), cookieHeader("", 0));
  }

  // Everything below needs a signed-in account.
  const id = await sessionAccountId(req);
  if (!id) return json({ error: "signed out" }, 401);
  const a = await getAccount(id);
  if (!a) return json({ error: "signed out" }, 401);

  if (action === "me") {
    const out = publicAccount(a, await getImages(id));
    out.payLink = process.env.TOPAZ_PAYMENT_LINK ? withRef(process.env.TOPAZ_PAYMENT_LINK, id, a.email) : null;
    // Direct Opal sign-up (the founding code is typed at checkout). Only offered once Opal is live.
    out.opalLink = opalLive(a) && process.env.OPAL_PAYMENT_LINK ? withRef(process.env.OPAL_PAYMENT_LINK, id, a.email) : null;
    out.canUpgrade = opalLive(a);
    out.widgetOk = opalOk(a);
    return json({ ok: true, account: out });
  }

  if (action === "brand" && req.method === "POST") {
    const b = await body(req);
    a.brand = cleanBrand(b.brand || {});
    const imgs = await getImages(id);
    try {
      if ("logo" in b) imgs.logo = cleanImage(b.logo);
      if ("headshot" in b) imgs.headshot = cleanImage(b.headshot);
    } catch (e) { return json({ error: e.message }, 400); }
    await saveImages(id, imgs);
    await saveAccount(a);
    return json({ ok: true, account: publicAccount(a, imgs) });
  }


  // ---- Opal widget settings (hosted link + embed) and the leads it collects
  if (action === "widget") {
    if (!opalOk(a)) return json({ error: "The widget is part of Opal." }, 403);
    if (req.method === "POST") {
      const b = await body(req);
      const h = String(b.handle || "").trim().toLowerCase();
      if (!HANDLE_RE.test(h) || RESERVED.has(h)) return json({ error: "Use 3 to 40 letters, numbers or dashes, with no spaces." }, 400);
      const owner = await s.get("handle:" + h);
      if (owner && owner !== id) return json({ error: "That page name is taken. Try another." }, 409);
      const notify = normEmail(b.notify || "");
      if (notify && !validEmail(notify)) return json({ error: "Enter a valid email for lead alerts." }, 400);
      const old = a.widget?.handle;
      if (old && old !== h) await s.delete("handle:" + old);
      await s.set("handle:" + h, id);
      a.widget = { handle: h, enabled: !!b.enabled, notify, intro: clip(b.intro, 160) };
      await saveAccount(a);
    }
    const w = a.widget || null;
    const url = w ? `${SITE()}/w/${w.handle}` : null;
    return json({
      ok: true, widget: w, url,
      embed: url ? `<iframe src="${url}?embed=1" title="Payment estimate" width="100%" height="900" style="border:0;max-width:640px" loading="lazy"></iframe>` : null,
    });
  }

  if (action === "leads") {
    if (!opalOk(a)) return json({ error: "Leads are part of Opal." }, 403);
    const prefix = "lead:" + id + ":";
    const { blobs } = await s.list({ prefix });
    const keys = blobs.map((x) => x.key).sort().reverse().slice(0, 100);
    const leads = [];
    for (const k of keys) { const l = await s.get(k, { type: "json" }); if (l) leads.push(l); }
    return json({ ok: true, leads });
  }

  // ---- how busy the page is: visits, estimates, Affordability checks and leads (counts only)
  if (action === "stats") {
    if (!opalOk(a)) return json({ error: "Activity is part of Opal." }, 403);
    return json({ ok: true, ...(await readStats(id, 30)) });
  }

  // ---- the member's own saved scenarios. Leads (visitor scenarios) live under another prefix and have no edit route.
  const SCN_KEYS = { calc: ["voklogik:calcState", "voklogik:payment"], aff: ["voklogik:affState", "voklogik:payment"] };
  const SID = /^\d{4}-\d\d-\d\dT[\d:.]+Z~[a-f0-9]{6}$/;
  if (action === "scenarios") {
    if (!opalOk(a)) return json({ error: "Saved scenarios are part of Opal." }, 403);
    const { blobs } = await s.list({ prefix: "scn:" + id + ":" });
    const keys = blobs.map((x) => x.key).sort().reverse().slice(0, 100);
    const list = [];
    for (const k of keys) { const v = await s.get(k, { type: "json" }); if (v) list.push({ id: k.slice(("scn:" + id + ":").length), name: v.name, kind: v.kind, at: v.at, summary: v.summary }); }
    return json({ ok: true, scenarios: list });
  }
  if (action === "scenario") {
    if (!opalOk(a)) return json({ error: "Saved scenarios are part of Opal." }, 403);
    const pre = "scn:" + id + ":";
    if (req.method === "GET") {
      const sid = new URL(req.url).searchParams.get("id") || "";
      if (!SID.test(sid)) return json({ error: "not found" }, 404);
      const v = await s.get(pre + sid, { type: "json" });
      return v ? json({ ok: true, scenario: { id: sid, ...v } }) : json({ error: "not found" }, 404);
    }
    const b = await body(req), op = String(b.op || "");
    if (op === "save") {
      const kind = b.kind === "aff" ? "aff" : b.kind === "calc" ? "calc" : null;
      const name = clip(b.name, 60);
      if (!kind) return json({ error: "Could not tell which page this came from." }, 400);
      if (!name) return json({ error: "Give the scenario a name." }, 400);
      const { blobs } = await s.list({ prefix: pre });
      if (blobs.length >= 50) return json({ error: "You have 50 saved scenarios. Delete one to save another." }, 400);
      const snap = {};
      let size = 0;
      for (const key of SCN_KEYS[kind]) {
        const v = b.snap && b.snap[key];
        if (typeof v !== "string") continue;
        size += v.length;
        try { JSON.parse(v); } catch { return json({ error: "That scenario could not be read." }, 400); }
        snap[key] = v;
      }
      if (size > 120000) return json({ error: "That scenario is too large to save." }, 400);
      if (!snap["voklogik:calcState"] && !snap["voklogik:affState"]) return json({ error: "Enter some numbers first, then save." }, 400);
      const summary = (Array.isArray(b.summary) ? b.summary : []).slice(0, 80)
        .map((r) => (Array.isArray(r) ? [clip(r[0], 80), clip(r[1], 100)] : null)).filter((r) => r && (r[0] || r[1]));
      const at = new Date().toISOString(), sid = at + "~" + sha256(id + at + Math.random()).slice(0, 6);
      await s.setJSON(pre + sid, { name, kind, at, summary, snap });
      return json({ ok: true, id: sid });
    }
    const sid = String(b.id || "");
    if (!SID.test(sid)) return json({ error: "not found" }, 404);
    const cur = await s.get(pre + sid, { type: "json" });
    if (!cur) return json({ error: "not found" }, 404);
    if (op === "rename") {
      const name = clip(b.name, 60);
      if (!name) return json({ error: "Give the scenario a name." }, 400);
      cur.name = name; await s.setJSON(pre + sid, cur);
      return json({ ok: true });
    }
    if (op === "delete") { await s.delete(pre + sid); return json({ ok: true }); }
    return json({ error: "not found" }, 404);
  }

  // Spend one branded report. Called before a branded PDF / print is produced.
  if (action === "use" && req.method === "POST") {
    if (!isActive(a)) return json({ ok: false, error: "Topaz is not active on this account." }, 402);
    const u = usage(a);
    if (u.limit != null && u.used >= u.limit) {
      return json({ ok: false, error: `You have used all ${TOPAZ_REPORTS} branded reports for this period.`, left: 0 }, 402);
    }
    a.usedKey = u.key; a.used = u.used + 1;
    await saveAccount(a);
    return json({ ok: true, left: u.limit == null ? null : u.limit - a.used });
  }

  if (action === "portal" && req.method === "POST") {
    if (!a.customer) return json({ error: "No billing profile yet." }, 400);
    try {
      const origin = new URL(req.url).origin;
      const p = await stripeApi("/billing_portal/sessions", { customer: a.customer, return_url: origin + "/topaz.html" });
      return json({ ok: true, url: p.url });
    } catch (e) { return json({ error: e.message }, 502); }
  }

  // Topaz -> Opal. Stripe credits the unused Topaz days and charges the Opal difference for the
  // days left in the period; the full Opal price starts at the next renewal. No founding coupon is
  // attached here, by design: it is only for businesses that join Opal directly.
  if (action === "upgrade" && req.method === "POST") {
    const price = process.env.OPAL_PRICE_ID;
    if (!opalLive(a)) return json({ error: "Opal is not open yet." }, 503);
    if (a.plan !== "topaz" || !a.subscription) return json({ error: "Only an active Topaz plan can upgrade." }, 400);
    const ENDMSG = "Your Topaz plan is set to end, so it cannot be upgraded. Use \"Manage or cancel your subscription\" to keep it going first, or start Opal as a new plan.";
    if (a.cancelAtPeriodEnd) return json({ error: ENDMSG }, 400);
    try {
      const sub = await stripeApi("/subscriptions/" + a.subscription, {}, "GET");
      if (sub.cancel_at_period_end || sub.cancel_at || !["active", "trialing"].includes(sub.status)) return json({ error: ENDMSG }, 400);
      const item = sub.items.data[0].id;
      await stripeApi("/subscriptions/" + a.subscription, {
        "items[0][id]": item, "items[0][price]": price,
        proration_behavior: "create_prorations", payment_behavior: "error_if_incomplete",
      });
      a.plan = "opal"; a.upgradedAt = new Date().toISOString();
      await saveAccount(a);
      return json({ ok: true });
    } catch (e) { return json({ error: e.message }, 502); }
  }

  return json({ error: "not found" }, 404);
};
