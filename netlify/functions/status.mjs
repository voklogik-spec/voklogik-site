import { ID_RE, getEnt, json, monthKey } from "../lib/common.mjs";

export default async (req) => {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!ID_RE.test(id)) return json({ error: "bad id" }, 400);
  const ent = await getEnt(id);
  // Individuals can buy one 25-report pack per calendar month.
  return json({ credits: ent.credits || 0, sub: !!ent.sub, canBuyPack: ent.packMonth !== monthKey() });
};
