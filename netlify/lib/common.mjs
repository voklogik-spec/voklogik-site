import { getStore } from "@netlify/blobs";

export const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

const entitlements = () => getStore({ name: "entitlements", consistency: "strong" });
export const payments = () => getStore({ name: "payments", consistency: "strong" });

export async function getEnt(id) {
  return (await entitlements().get(id, { type: "json" })) || { credits: 0, sub: false };
}

export async function setEnt(id, ent) {
  await entitlements().setJSON(id, { ...ent, updatedAt: new Date().toISOString() });
}

export const PASS_DAYS = 30;
export const passEnd = (from = Date.now()) => new Date(new Date(from).getTime() + PASS_DAYS * 86400000).toISOString();
// Credits that are still usable: a Homebuyer Pass expires 30 days after purchase.
// Entries with no creditsUntil (older packs) never expire.
export const liveCredits = (ent) =>
  !ent || !(ent.credits > 0) ? 0 : ent.creditsUntil && Date.parse(ent.creditsUntil) < Date.now() ? 0 : ent.credits;

export const monthKey = () => new Date().toISOString().slice(0, 7); // calendar month, UTC

export const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
