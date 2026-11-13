import { store } from "../lib/topaz.mjs";
import { expiredKeys } from "../lib/retention.mjs";

// Runs once a day. Deletes leads older than 12 months and spam-limit counters older than 48 hours.
export const config = { schedule: "@daily" };

export default async () => {
  const s = store();
  let deleted = 0;
  for (const prefix of ["lead:", "rl:", "rlp:"]) {
    const { blobs } = await s.list({ prefix });
    for (const key of expiredKeys(blobs.map((b) => b.key))) {
      try { await s.delete(key); deleted++; } catch (e) { console.error("purge-old: could not delete", key, e.message); }
    }
  }
  console.log("purge-old: deleted", deleted, "expired records");
};
