import { verifyStripeSignature } from "../lib/stripe-sig.mjs";
import { ID_RE, getEnt, setEnt, payments, json } from "../lib/common.mjs";

const PACK_CREDITS = 25; // reports added by the one-time $4.99 pack

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json({ error: "webhook secret not configured" }, 500);

  const raw = await req.text();
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"), secret)) {
    return json({ error: "invalid signature" }, 400);
  }

  const event = JSON.parse(raw);
  const obj = event.data.object;
  const log = payments();

  // A paid checkout: credit the browser id that was attached to the payment link.
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    if (obj.payment_status !== "paid") return json({ received: true, ignored: "not paid yet" });

    const key = "session:" + obj.id;
    if (await log.get(key)) return json({ received: true, duplicate: true });

    // Every paid session gets a record, so the claim function can later move the purchase
    // to whichever browser the customer comes back in.
    const record = {
      state: "credited",
      vid: null,
      mode: obj.mode,
      subscription: obj.subscription || null,
      credits: obj.mode === "payment" ? PACK_CREDITS : 0,
      email: obj.customer_details?.email || null,
      at: new Date().toISOString(),
    };

    const id = obj.client_reference_id;
    if (!ID_RE.test(id || "")) {
      // Paid without going through the site's buttons: nobody to credit yet.
      // The customer's return page can claim it with the session id.
      await log.setJSON("unclaimed:" + obj.id, {
        email: record.email,
        mode: obj.mode,
        amount: obj.amount_total,
        at: record.at,
      });
      record.state = "unclaimed";
      await log.setJSON(key, record);
      return json({ received: true, unclaimed: true });
    }

    const ent = await getEnt(id);
    if (obj.mode === "subscription") {
      ent.sub = true;
      ent.subscription = obj.subscription;
      if (obj.subscription) await log.set("sub:" + obj.subscription, id);
    } else if (obj.mode === "payment") {
      ent.credits = (ent.credits || 0) + PACK_CREDITS;
    }
    ent.email = obj.customer_details?.email || ent.email;
    await setEnt(id, ent);
    record.vid = id;
    await log.setJSON(key, record); // written last, after the credit is in place
    return json({ received: true });
  }

  // Subscription changes: keep the unlimited plan in sync with Stripe.
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const id = await log.get("sub:" + obj.id);
    if (!id) return json({ received: true, ignored: "unknown subscription" });
    const ent = await getEnt(id);
    ent.sub =
      event.type !== "customer.subscription.deleted" &&
      ["active", "trialing", "past_due"].includes(obj.status);
    await setEnt(id, ent);
    return json({ received: true });
  }

  return json({ received: true });
};
