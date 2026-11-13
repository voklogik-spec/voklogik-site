// Retention rules for data kept in the "topaz" blob store.
//   lead:<account>:<ISO time>:<hash>   leads sent through a member's page: kept 12 months
//   rl:<hash>:<account>:<YYYY-MM-DDTHH>  spam-limit counters (scrambled network address): kept 48 hours
//   rlp:<account>:<YYYY-MM-DDTHH>        spam-limit counters per page: kept 48 hours
export const LEAD_DAYS = 365;
export const LIMIT_HOURS = 48;

const LEAD_AT = /:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z):[^:]+$/;
const LIMIT_HOUR = /:(\d{4}-\d{2}-\d{2}T\d{2})$/;

// Returns the keys that are past their retention period. A key that does not match a known
// shape is never returned, so nothing unexpected is ever deleted.
export function expiredKeys(keys, now = Date.now()) {
  const out = [];
  for (const k of keys) {
    let m;
    if (k.startsWith("lead:") && (m = LEAD_AT.exec(k))) {
      const t = Date.parse(m[1]);
      if (Number.isFinite(t) && now - t > LEAD_DAYS * 86400000) out.push(k);
    } else if ((k.startsWith("rl:") || k.startsWith("rlp:")) && (m = LIMIT_HOUR.exec(k))) {
      const t = Date.parse(m[1] + ":00:00Z");
      if (Number.isFinite(t) && now - t > LIMIT_HOURS * 3600000) out.push(k);
    }
  }
  return out;
}
