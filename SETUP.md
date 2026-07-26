# Efficiency Education — Stripe premium setup

Your app now verifies premium against Stripe instead of trusting the browser.
Do these steps **in order**. Nothing charges real money until you switch out of
sandbox.

---

## What changed in the app

- Premium is no longer granted just because the URL says `?premium=success`.
- On sign-in (and every ~6 hours, and when you return to the tab) the app asks a
  small serverless function whether that email has a **live Stripe subscription**.
- Because Stripe is the source of truth, premium now: expires with the plan,
  re-checks itself, follows the person to any device they sign in on, and
  survives cache clears and site redeploys.
- Checkout is pre-filled with the signed-in email, so a payment always ties to
  the right account.
- **New-device verification.** When a *premium* account is opened on a device
  it hasn't seen before, premium stays locked until a 6-digit code emailed to
  the account address is entered. The first device is trusted automatically;
  every later device needs the code. This stops a premium login being shared by
  email alone. (Free/trial use is never gated.)
- **Admin is now server-protected.** The admin password lives on the server, and
  *setting* it the first time requires a one-time setup secret only you hold — so
  a fresh browser can't self-grant admin (or the free premium that came with it).

---

## Step 1 — Deploy the function (do this FIRST)

Drag-and-drop deploys **do not** include functions. Use one of:

**A. Git-connected site (recommended)**
1. Put these files at the root of your repo, next to `study-studio.html`:
   - `netlify.toml`
   - `package.json`  ← lets Netlify install the functions' dependencies
   - `netlify/functions/check-premium.js`
   - `netlify/functions/device-verify.js`
   - `netlify/functions/admin-auth.js`
2. Push. Netlify runs `npm install` and publishes all three functions automatically.

**B. Netlify CLI**
```
npm install -g netlify-cli
netlify deploy --prod
```

Your functions will live at:
`https://efficiencyeducation.netlify.app/.netlify/functions/check-premium`
`https://efficiencyeducation.netlify.app/.netlify/functions/device-verify`
`https://efficiencyeducation.netlify.app/.netlify/functions/admin-auth`

> Device + admin state is stored in **Netlify Blobs**, which is built in and
> enabled automatically — nothing to configure. (Drag-and-drop deploys still
> won't work: they skip both the functions and the `npm install`.)
>
> If your published HTML isn't at the repo root, set `publish` in `netlify.toml`
> to the folder that contains it.

---

## Step 2 — Add your environment variables (never in the HTML)

Netlify → **Site settings → Environment variables → Add a variable**. Add all four:

| Key                      | Value                                                        |
| ------------------------ | ------------------------------------------------------------ |
| `STRIPE_SECRET_KEY`      | `sk_test_...` while testing in sandbox (`sk_live_...` later) |
| `RESEND_API_KEY`         | Your Resend API key (see Step 2b) — sends the device codes   |
| `MAIL_FROM`              | The "from" address, e.g. `Efficiency Education <noreply@yourdomain.com>` |
| `ADMIN_BOOTSTRAP_SECRET` | Any long random string you invent — needed once to set the admin password |

`STRIPE_SECRET_KEY` is the only one you change for go-live (swap test → live).
Keep `ADMIN_BOOTSTRAP_SECRET` private; it's what proves *you* are setting up admin.

### Step 2b — Get a Resend key (for the device-verification emails)

1. Create a free account at **resend.com** (the free tier covers ~3,000 emails/mo).
2. **API Keys → Create API Key** → copy it into `RESEND_API_KEY`.
3. For real sending, add and **verify your domain** in Resend, then set `MAIL_FROM`
   to an address on that domain. For a quick test you can leave `MAIL_FROM` unset —
   the function falls back to `onboarding@resend.dev`, which Resend only delivers to
   *your own* account email. (To swap providers later, edit the one `sendEmail`
   function in `netlify/functions/device-verify.js`.)

---

## Step 2c — Set the admin password (once)

After the first deploy, sign in with your admin email (`arthurmmturner2@…`). You'll
be asked for the **setup secret** (your `ADMIN_BOOTSTRAP_SECRET`) and a new admin
password. Do this once; from then on every device just asks for the password, and
nobody without the secret can set or reset it.

---

## Step 3 — Create the four Payment Links

In Stripe (sandbox for now):

1. Create three **recurring** prices — **$1 / week**, **$4 / month**, **$48 / year** —
   and one **one-time** price of **$140** for the **lifetime** plan.
   (Lifetime is a single payment, not a subscription. The check function detects
   it as a paid one-time checkout, so it never expires.)
2. Turn each into a **Payment Link** (you chose *Shareable payment links* — correct).
3. On each link's **Confirmation page** tab, choose *"Don't show a confirmation
   page"* and set the redirect to:
   `https://efficiencyeducation.netlify.app/?premium=success`

---

## Step 4 — Paste the links into the app

Open `study-studio.html`, find `PAY_LINKS` near the top of the script, and paste:

```js
const PAY_LINKS = {
  week:     "https://buy.stripe.com/....",
  month:    "https://buy.stripe.com/....",
  year:     "https://buy.stripe.com/....",
  lifetime: "https://buy.stripe.com/...."
};
```

(These four links are already filled in with the URLs you provided.) Redeploy.

---

## Step 5 — Test the full loop (sandbox)

1. Open the site, **sign in** with a test email (not guest — guest never saves).
2. Upgrade → pay with card `4242 4242 4242 4242`, any future expiry, any CVC.
3. You're redirected back and premium unlocks within a few seconds.
4. In the Stripe Dashboard, **cancel** that subscription.
5. Reload or return to the tab — access drops on the next check. That's the loop
   working end to end.
6. **Test new-device verification:** sign in with the same email in a private/
   incognito window (a "new device"). Premium stays locked and a 6-digit code is
   emailed — enter it and premium unlocks there too. (The very first device is
   trusted with no code.)

---

## Step 6 — Go live

- In Stripe, switch from Sandbox to your live account and recreate the four
  Payment Links (live links are different URLs). Update `PAY_LINKS`.
- Swap `STRIPE_SECRET_KEY` to your `sk_live_...` key.
- Make sure `RESEND_API_KEY` / `MAIL_FROM` use a **verified domain** (not the
  `resend.dev` test address) so codes reach real customers.
- Complete Stripe's business/bank details so payouts can reach you.

---

## Good to know

- **Buyer email must match app email.** The app pre-fills it at checkout, so this
  is handled automatically as long as they don't change it on the Stripe page.
- **Fails safe.** If the function is down or the person is offline, the app leaves
  premium exactly as it was — it never locks a paying customer out on a hiccup,
  and it never *grants* premium without a real Stripe "active" answer.
- **Grace period.** There's a 1-day cushion after a period ends, so a late
  renewal won't interrupt someone mid-session.
- **Lifetime is permanent.** A one-time $140 purchase never expires and outranks
  any subscription. Note: if you *refund* a lifetime payment, access is not
  revoked automatically (Stripe leaves the checkout marked "paid") — you'd remove
  that access by hand. Subscriptions still drop on cancel as normal.
- **New devices, not new sign-ins.** A device stays trusted once verified, so
  people aren't re-prompted every visit. Clearing browser storage makes that
  browser look "new," so it'll ask for a code again — expected.
- **The code goes to the account's inbox.** Someone who was simply *told* the
  email can't receive the code, which is the point. If a customer genuinely can't
  get their code, you can clear their trusted-device list in the Netlify Blobs
  store (key `dev_<hash of email>`).
- **Admin can't be self-granted anymore**, but note this is still a client-gated
  study app: a determined technical user with dev-tools can flip in-page flags.
  The server checks (Stripe subscription, device trust, admin password + setup
  secret) are what actually hold — they can't be forged from the browser.
- **Optional upgrade later:** add a Stripe *webhook* to push changes instantly
  instead of waiting for the next check. Not required — the polling model above
  is plenty for launch.
