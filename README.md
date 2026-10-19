# Voklogik site + Stripe payment confirmations

Files
- public/: the website files (index.html, privacy.html, terms.html, robots.txt, sitemap.xml, favicon.svg, og-image.png)
- netlify/functions/stripe-webhook.mjs: receives Stripe's payment confirmations
- netlify/functions/status.mjs: tells the page how many paid reports a visitor has
- netlify/functions/consume.mjs: uses up one paid report
- netlify/functions/claim.mjs: attaches a paid purchase to the browser the customer returns in (a safety net for different browsers and links used outside the site's buttons)
- netlify.toml, package.json: Netlify settings

How it works
1. The page gives each browser a random private id and adds it to the Stripe links as client_reference_id.
2. After payment, Stripe calls stripe-webhook. It checks Stripe's signature, then adds 25 reports (pack) or turns on the unlimited plan (monthly) for that id.
3. The page asks status for that id and unlocks. Cancelled subscriptions turn off automatically.

Set up (test mode first)
1. Deploy this whole folder to Netlify with the CLI or Git. Drag-and-drop of a single file does not run functions.
   CLI: npm install -g netlify-cli, then in this folder: npm install, netlify login, netlify link, netlify deploy --prod
2. In Stripe (test mode), Developers > Webhooks > Add endpoint:
   URL: https://YOUR-SITE/.netlify/functions/stripe-webhook
   Events: checkout.session.completed, checkout.session.async_payment_succeeded, customer.subscription.updated, customer.subscription.deleted
3. Copy the endpoint's signing secret (starts with whsec_). In Netlify > Site configuration > Environment variables, add STRIPE_WEBHOOK_SECRET with that value. Redeploy.
4. On each Stripe Payment Link, set After payment to "Don't show confirmation page" and redirect to https://YOUR-SITE/?paid=1&session_id={CHECKOUT_SESSION_ID} (Stripe replaces the placeholder with the order's session id)
5. Test with Stripe test links and test card 4242 4242 4242 4242, then repeat with live mode: live links, a live webhook endpoint and its own signing secret.

Payments made without using the site's buttons, or finished in a different browser, are matched when the customer lands on the return address: the page sends the session id to claim.mjs, which credits the purchase to that browser once. Every paid session has a record in the "payments" blob store under session:<id>; unclaimed ones also have an unclaimed:<id> record with the customer's email.

## Topaz (business accounts)

New files: `public/topaz.html`, `public/topaz-brand.js`, `netlify/functions/topaz.mjs`, `netlify/lib/topaz.mjs`, and Topaz handling added to `stripe-webhook.mjs`.

Setup in Stripe (live mode):
1. Create a product "Topaz Tier" with a recurring price of $29.99 per month, then a Payment Link for it. In the link's After payment settings, send customers to `https://voklogik.com/topaz.html?paid=1`.
2. In Netlify environment variables add `TOPAZ_PAYMENT_LINK` (the buy.stripe.com link) and `STRIPE_SECRET_KEY` (a restricted key: Subscriptions read/write, Billing portal write, Customers read).
3. Turn on the Customer portal in Stripe (Settings > Billing > Customer portal) so Manage billing works.
4. Make sure the existing webhook also sends `customer.subscription.updated` and `customer.subscription.deleted` (it already receives `checkout.session.completed`).
5. Opal (built in stages, switched on by you): `OPAL_PRICE_ID` (the $79 monthly price) and `OPAL_PAYMENT_LINK` (its buy.stripe.com link) can sit in Netlify safely. Nothing shows to members until you also add `OPAL_LIVE` = `1`. That switch turns on the Upgrade button (with proration) and the "Start with Opal instead" link. The $49.99 first-year coupon (code FOUNDING20, 20 redemptions, first-time orders only) is typed at checkout by direct Opal sign-ups only.

How it works: accounts and branding live in the Netlify Blobs store "topaz". The payment link carries the account id (starts with `tz_`) so the webhook activates the right account. Each saved or printed report calls `/api/topaz/use`, which counts against 200 per billing period.

### Password reset

Needs email sending. In Netlify add `SMTP_USER` (hello@voklogik.com) and `SMTP_PASS` (a Zoho application-specific password: Zoho Account > Security > App Passwords). Optional: `SMTP_HOST` (default smtp.zoho.com), `SITE_URL` (default https://voklogik.com). Package `nodemailer` is added to package.json, so Netlify installs it on the next deploy. Reset links work for 60 minutes, once, and a reset signs out every device.


## Opal widget (hosted page and embed)
- Public page: `/w/<page-name>` (rewrite in netlify.toml to `public/w.html`). Embed mode: `?embed=1`.
- Functions: `netlify/functions/widget.mjs` (public profile and lead capture). Member settings and leads live in `topaz.mjs` (`widget` and `leads` actions).
- Leads are emailed to the member (their lead-alert email, else their branding email, else their login email) with a copy to `LEADS_BCC`, which defaults to `SMTP_USER` (hello@voklogik.com). They are also kept in the "topaz" blob store.
- Spam controls: hidden field, consent box required, 3 sends per visitor and 20 per page per hour.
- To try Opal features on your own account before launch, add `OPAL_PREVIEW_EMAILS` (comma list of login emails) in Netlify. Those accounts get the widget, the Upgrade button and the Opal link. Everyone else sees nothing until `OPAL_LIVE=1`.

### Affordability inside the widget
- The widget page links to `/affordability.html?w=<page-name>` (add `&embed=1` when embedded). The payment numbers travel in the link and are seeded into the same `voklogik:payment` storage the calculator uses.
- In that mode the page hides the site header, upsells, key-in sheet and report counting, shows the member's card, and reports carry the member's branding. `public/widget-aff.js` adds the card, the back link and the "send my summary" form.
- Leads can carry the Affordability summary (up to 80 rows). They are emailed and shown in the member's dashboard.
- Plans: Topaz = up to 200 branded reports a month, no page, no lead alerts, no scenarios dashboard. Opal = unlimited reports, the co-branded page (payment estimate + Affordability), lead alerts and visitor scenarios in the dashboard. Opal uses its own pearl theme.

## Opal: saved scenarios, page activity, Apricot Pearl
- Saved scenarios: Opal members tap "Save scenario" in the bar on the calculator or Affordability page. They are listed on the dashboard (open, rename, delete, 50 max). Blob keys `scn:<acct>:<id>`. Visitor scenarios are leads (`lead:` keys) and have no edit route.
- Page activity: `POST /api/widget/event` (view, estimate, aff) plus leads add to daily counters `stat:<acct>:<YYYY-MM-DD>`. Bots ignored, 30 events per visitor-hour, owner's "Open" link adds `?pv=1` so it is not counted. Counts are approximate (read-modify-write, UTC days).
- Palette: violet pearl with a champagne finish (last stop of the sheen strip and the gem ring).
- Opal reports: saved PDFs and printed pages use the violet header with a champagne rule (`VKTZ.opal()`, `html.vk-opal` print CSS). Topaz and unbranded reports keep orange and cream.
- Footer "Add to home screen" link (`public/install-tip.js`, on the calculator and Affordability pages): steps for iPhone, Android and computer, plus an Install now button when the browser offers it. Hidden inside the installed app.
- Affordability additions: credit card minimum-payment hint; earnest money asset (paid and cleared is credited at closing); optional amount of a non-liquid account counted as liquid; Cash Required at Closing (down payment balance + 2-5% fees estimate, or own figure, less earnest); Liquid Assets > Cash Required Yes/No with the math; collapsible multi-borrower income with totals and a borrower count beside Gross Monthly Income. All appear in the detailed PDF, print and lead summary.
