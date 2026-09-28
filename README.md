# Voklogik site + Stripe payment confirmations

Files
- public/: the website files (index.html, privacy.html, terms.html, robots.txt, sitemap.xml, favicon.svg, og-image.png)
- netlify/functions/stripe-webhook.mjs: receives Stripe's payment confirmations
- netlify/functions/status.mjs: tells the page how many paid reports a visitor has
- netlify/functions/consume.mjs: uses up one paid report
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
4. On each Stripe Payment Link, set After payment to redirect to https://YOUR-SITE/?paid=1
5. Test with Stripe test links and test card 4242 4242 4242 4242, then repeat with live mode: live links, a live webhook endpoint and its own signing secret.

Payments made without using the site's buttons cannot be matched to a browser. They are saved as "unclaimed" records in the "payments" blob store so you can handle them by hand.
