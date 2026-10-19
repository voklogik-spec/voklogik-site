import {
  store, normEmail, validEmail, hashPw, checkPw, newAccountId, startSession, cookieHeader,
  sessionAccountId, endSession, getAccount, saveAccount, getImages, saveImages, isActive, usage,
  publicAccount, cleanImage, cleanBrand, stripeApi, TOPAZ_REPORTS,
  makeResetToken, readResetToken, dropResetToken, RESET_MINUTES,
} from "../lib/topaz.mjs";
import { sendMail } from "../lib/mail.mjs";
import { json } from "../lib/common.mjs";

export const config = { path: "/api/topaz/*" };

const withCookie = (res, c) => { res.headers.append("set-cookie", c); return res; };
const body = async (req) => { try { return await req.json(); } catch { return {}; } };
const emailKey = (e) => "user:" + e;
// Opal stays off until you set OPAL_LIVE=1 in Netlify, even when the price id is already there.
const opalLive = () => !!process.env.OPAL_PRICE_ID && process.env.OPAL_LIVE === "1";
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
    out.opalLink = opalLive() && process.env.OPAL_PAYMENT_LINK ? withRef(process.env.OPAL_PAYMENT_LINK, id, a.email) : null;
    out.canUpgrade = opalLive();
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
    if (!opalLive()) return json({ error: "Opal is not open yet." }, 503);
    if (a.plan !== "topaz" || !a.subscription) return json({ error: "Only an active Topaz plan can upgrade." }, 400);
    try {
      const sub = await stripeApi("/subscriptions/" + a.subscription, {}, "GET");
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
