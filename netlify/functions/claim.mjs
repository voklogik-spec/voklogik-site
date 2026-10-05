import { ID_RE, getEnt, setEnt, payments, json } from "../lib/common.mjs";

// Stripe checkout session ids look like cs_live_a1B2c3... (the customer's return page carries one).
const SESSION_RE = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/;

// Moves a paid purchase to the browser the customer came back in.
// Only someone holding the session id from their own return link can do this. The first claim
// (the buyer coming back, in any browser) locks the purchase, so it can be moved at most once.
export default async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad request" }, 400);
  }
  const id = body && body.id;
  const session = body && body.session;
  if (!ID_RE.test(id || "") || !SESSION_RE.test(session || "")) {
    return json({ error: "bad request" }, 400);
  }

  const log = payments();
  const key = "session:" + session;
  const raw = await log.get(key);
  if (!raw) return json({ ok: false, pending: true }); // Stripe's confirmation has not arrived yet

  let rec = null;
  try {
    rec = JSON.parse(raw);
  } catch {
    /* older purchases were stored as plain text */
  }
  if (!rec || typeof rec !== "object") return json({ ok: false, reason: "legacy" });

  if (rec.vid === id) {
    // Already credited to this browser. The buyer's own return locks the link,
    // so a copy of the return address cannot be used by anyone else afterwards.
    if (!rec.sealed) {
      rec.sealed = true;
      await log.setJSON(key, rec);
    }
    return json({ ok: true, already: true });
  }
  if (rec.transferred || rec.sealed) return json({ ok: false, reason: "already linked" });

  const oldId = rec.vid && ID_RE.test(rec.vid) ? rec.vid : null;

  // Record the move first, so a second request cannot repeat it.
  rec.vid = id;
  rec.transferred = true;
  rec.sealed = true;
  rec.movedAt = new Date().toISOString();
  await log.setJSON(key, rec);

  const dest = await getEnt(id);
  if (rec.mode === "subscription") {
    if (oldId) {
      const old = await getEnt(oldId);
      if (old.subscription === rec.subscription) {
        old.sub = false;
        delete old.subscription;
        await setEnt(oldId, old);
      }
    }
    dest.sub = true;
    dest.subscription = rec.subscription;
    if (rec.subscription) await log.set("sub:" + rec.subscription, id); // future cancellations follow the new browser
  } else if (rec.mode === "payment") {
    let moved = Number(rec.credits) || 0;
    if (oldId) {
      const old = await getEnt(oldId);
      moved = Math.min(moved, old.credits || 0); // only what is still unused
      old.credits = (old.credits || 0) - moved;
      await setEnt(oldId, old);
    }
    dest.credits = (dest.credits || 0) + moved;
  }
  if (rec.email) dest.email = rec.email;
  await setEnt(id, dest);
  return json({ ok: true, moved: true });
};
