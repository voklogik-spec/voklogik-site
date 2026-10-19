import { getStore } from "@netlify/blobs";
import { scryptSync, randomBytes, timingSafeEqual, createHash } from "node:crypto";

export const TOPAZ_REPORTS = 200; // branded reports per billing period
const SESSION_DAYS = 30;
export const COOKIE = "vk_topaz";

export const store = () => getStore({ name: "topaz", consistency: "strong" });
const sha = (s) => createHash("sha256").update(s).digest("hex");

export const normEmail = (e) => String(e || "").trim().toLowerCase();
export const validEmail = (e) => /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(e) && e.length <= 254;

export function hashPw(pw, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: scryptSync(pw, salt, 64).toString("hex") };
}
export function checkPw(pw, salt, hash) {
  const a = Buffer.from(scryptSync(pw, salt, 64).toString("hex"));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const newAccountId = () => "tz_" + randomBytes(15).toString("base64url");

export async function startSession(id) {
  const token = randomBytes(32).toString("base64url");
  const exp = Date.now() + SESSION_DAYS * 864e5;
  await store().setJSON("sess:" + sha(token), { id, exp, iat: Date.now() });
  return { token, exp };
}
export const cookieHeader = (token, maxAgeSec) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;

export function readToken(req) {
  const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|; )" + COOKIE + "=([A-Za-z0-9_-]+)"));
  return m ? m[1] : null;
}
export async function sessionAccountId(req) {
  const t = readToken(req);
  if (!t) return null;
  const s = await store().get("sess:" + sha(t), { type: "json" });
  if (!s || s.exp < Date.now()) return null;
  // A password change or reset signs out every session that started before it.
  const a = await getAccount(s.id);
  if (a?.pwChangedAt && (s.iat || 0) < Date.parse(a.pwChangedAt)) return null;
  return s.id;
}
export async function endSession(req) {
  const t = readToken(req);
  if (t) await store().delete("sess:" + sha(t));
}

export const getAccount = (id) => store().get("acct:" + id, { type: "json" });
export const saveAccount = (a) => store().setJSON("acct:" + a.id, { ...a, updatedAt: new Date().toISOString() });
export const getImages = async (id) => (await store().get("img:" + id, { type: "json" })) || {};
export const saveImages = (id, imgs) => store().setJSON("img:" + id, imgs);

// Active = paid and in good standing.
export const isActive = (a) => !!a && (a.plan === "topaz" || a.plan === "opal") && ["active", "trialing", "past_due"].includes(a.status);

// Usage is counted per billing period; a new period starts at zero.
export function usage(a) {
  const key = a.periodStart || "none";
  const used = a.usedKey === key ? a.used || 0 : 0;
  return { key, used, limit: a.plan === "opal" ? null : TOPAZ_REPORTS };
}

export function publicAccount(a, imgs) {
  const u = usage(a);
  return {
    id: a.id,
    email: a.email,
    plan: isActive(a) ? a.plan : "none",
    status: a.status || "none",
    periodEnd: a.periodEnd || null,
    cancelAtPeriodEnd: !!a.cancelAtPeriodEnd,
    used: u.used,
    limit: u.limit,
    left: u.limit == null ? null : Math.max(u.limit - u.used, 0),
    brand: { ...(a.brand || {}), logo: imgs?.logo || null, headshot: imgs?.headshot || null },
  };
}

const MAX_IMG = 220 * 1024; // chars of data URL per image (browser shrinks images first)
export function cleanImage(v) {
  if (v === null || v === "") return null;
  if (typeof v !== "string" || v.length > MAX_IMG) throw new Error("image too large");
  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v)) throw new Error("image must be PNG or JPEG");
  return v;
}
export const clip = (v, n) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, n);
export function cleanBrand(b) {
  return {
    name: clip(b.name, 80),
    company: clip(b.company, 80),
    title: clip(b.title, 60),
    phone: clip(b.phone, 30),
    email: clip(b.email, 120),
    website: clip(b.website, 120),
    mls: clip(b.mls, 40),
    nmls: clip(b.nmls, 20),
  };
}

export async function stripeApi(path, params, method = "POST") {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  const r = await fetch("https://api.stripe.com/v1" + path, {
    method,
    headers: { Authorization: "Bearer " + key, "content-type": "application/x-www-form-urlencoded" },
    body: method === "GET" ? undefined : new URLSearchParams(params).toString(),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "Stripe error");
  return j;
}

// ---- password reset
export const RESET_MINUTES = 60;
export async function makeResetToken(id, email) {
  const token = randomBytes(32).toString("base64url");
  await store().setJSON("reset:" + sha(token), { id, email, exp: Date.now() + RESET_MINUTES * 60000 });
  return token;
}
export async function readResetToken(token) {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token || "")) return null;
  const r = await store().get("reset:" + sha(token), { type: "json" });
  return r && r.exp > Date.now() ? r : null;
}
export const dropResetToken = (token) => store().delete("reset:" + sha(token));

// ---- Opal features (widget, leads)
// OPAL_PREVIEW_EMAILS (comma list in Netlify) lets you try Opal on your own account before launch.
export const previewEmail = (e) =>
  (process.env.OPAL_PREVIEW_EMAILS || "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean).includes(normEmail(e));
export const opalOk = (a) => !!a && (previewEmail(a.email) || (a.plan === "opal" && isActive(a)));

export const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
export const RESERVED = new Set(["api", "admin", "www", "w", "topaz", "opal", "voklogik", "app", "login", "support", "help", "terms", "privacy", "affordability", "index", "static", "assets"]);
export const SITE = () => process.env.SITE_URL || "https://voklogik.com";
export const sha256 = sha;

// ---- Opal page activity: plain daily counters per member. No names, no addresses.
export const STAT_FIELDS = ["view", "estimate", "aff", "lead"];
export async function countStat(id, field, when = new Date()) {
  if (!STAT_FIELDS.includes(field)) return;
  const s = store(), k = "stat:" + id + ":" + when.toISOString().slice(0, 10);
  const cur = (await s.get(k, { type: "json" })) || {};
  cur[field] = (Number(cur[field]) || 0) + 1;
  await s.setJSON(k, cur);
}
export async function readStats(id, days = 30, now = new Date()) {
  const s = store();
  const { blobs } = await s.list({ prefix: "stat:" + id + ":" });
  const cutoff = new Date(now.getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const keys = blobs.map((x) => x.key).filter((k) => k.slice(-10) >= cutoff).sort();
  const out = [];
  for (const k of keys) {
    const v = (await s.get(k, { type: "json" })) || {};
    out.push({ d: k.slice(-10), view: v.view || 0, estimate: v.estimate || 0, aff: v.aff || 0, lead: v.lead || 0 });
  }
  const sum = (rows) => rows.reduce((t, r) => { for (const f of STAT_FIELDS) t[f] += r[f]; return t; }, { view: 0, estimate: 0, aff: 0, lead: 0 });
  const c7 = new Date(now.getTime() - 6 * 86400000).toISOString().slice(0, 10);
  return { days: out, d7: sum(out.filter((r) => r.d >= c7)), d30: sum(out) };
}
