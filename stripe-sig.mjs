import crypto from "node:crypto";

// Verifies a Stripe webhook signature header ("t=...,v1=...") against the raw request body.
export function verifyStripeSignature(raw, header, secret, toleranceSeconds = 300) {
  if (!header || !secret) return false;
  let t = null;
  const sigs = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1") sigs.push(v);
  }
  if (!t || sigs.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSeconds) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${raw}`, "utf8").digest("hex");
  const b = Buffer.from(expected);
  return sigs.some((s) => {
    const a = Buffer.from(s);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}
