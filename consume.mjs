import { ID_RE, getEnt, setEnt, json } from "../lib/common.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  let id;
  try {
    ({ id } = await req.json());
  } catch {
    return json({ error: "bad json" }, 400);
  }
  if (!ID_RE.test(id || "")) return json({ error: "bad id" }, 400);

  const ent = await getEnt(id);
  if (ent.sub) return json({ ok: true, unlimited: true });
  if ((ent.credits || 0) > 0) {
    ent.credits -= 1;
    await setEnt(id, ent);
    return json({ ok: true, credits: ent.credits });
  }
  return json({ ok: false, credits: 0 });
};
