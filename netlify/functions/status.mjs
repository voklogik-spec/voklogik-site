import { ID_RE, getEnt, json, liveCredits } from "../lib/common.mjs";

export default async (req) => {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!ID_RE.test(id)) return json({ error: "bad id" }, 400);
  const ent = await getEnt(id);
  // Homebuyer Pass: 25 reports for 30 days. A new one can be bought once the old one has ended or run out.
  const credits = liveCredits(ent);
  return json({ credits, until: credits ? ent.creditsUntil || null : null, sub: !!ent.sub, canBuyPack: credits === 0 });
};
