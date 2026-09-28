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

export const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
