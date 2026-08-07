// check-premium.js  —  Netlify serverless function
// -----------------------------------------------------------------------------
// Answers one question for the app: "does this email have a live Stripe
// subscription right now?"  The Stripe SECRET key lives ONLY here, injected as a
// Netlify environment variable — it is never sent to the browser.
//
// The app POSTs { "email": "someone@example.com" } and gets back:
//   { active: true,  plan: "month",    status: "active", currentPeriodEnd: 1730000000000 }
//   { active: true,  plan: "lifetime", status: "active", currentPeriodEnd: null }  // one-time, never expires
//   { active: false }
//
// No npm packages required — Netlify runs Node 18+, which has global fetch.
// -----------------------------------------------------------------------------

const STRIPE_API = "https://api.stripe.com/v1";

async function stripeGet(path, key) {
  const res = await fetch(STRIPE_API + path, {
    headers: { Authorization: "Bearer " + key },
  });
  if (!res.ok) throw new Error("Stripe responded " + res.status);
  return res.json();
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Use POST" }) };
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server not configured" }) };
  }

  let email = "";
  try { email = (JSON.parse(event.body || "{}").email || "").trim().toLowerCase(); } catch (e) {}
  if (!email || email.indexOf("@") < 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "email required" }) };
  }

  const ENTITLING = ["active", "trialing", "past_due"]; // still let them in during a payment retry

  try {
    // The same email can map to more than one Stripe customer — check each.
    const custs = await stripeGet(
      "/customers?email=" + encodeURIComponent(email) + "&limit=100",
      key
    );

    let sub = null; // first live subscription we find, if any

    for (const c of custs.data || []) {
      // 1) LIFETIME — a one-time (non-recurring) purchase. A Payment Link for a
      //    one-time price checks out in "payment" mode, creating a Checkout
      //    Session with mode:"payment". A paid one means they bought lifetime,
      //    which never expires, so it wins over any subscription.
      const sessions = await stripeGet(
        "/checkout/sessions?customer=" + c.id + "&limit=100",
        key
      );
      const paidOnce = (sessions.data || []).find(
        (s) => s.mode === "payment" && s.payment_status === "paid"
      );
      if (paidOnce) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            active: true,
            plan: "lifetime",
            status: "active",
            currentPeriodEnd: null, // permanent — no expiry
          }),
        };
      }

      // 2) SUBSCRIPTION — weekly / monthly / yearly. Remember the first live one.
      if (!sub) {
        const subs = await stripeGet(
          "/subscriptions?customer=" + c.id + "&status=all&limit=100",
          key
        );
        sub = (subs.data || []).find((s) => ENTITLING.includes(s.status)) || null;
      }
    }

    if (sub) {
      const item = sub.items && sub.items.data && sub.items.data[0];
      const interval =
        item && item.price && item.price.recurring && item.price.recurring.interval;
      const plan =
        interval === "week" ? "week" :
        interval === "year" ? "year" :
        interval === "month" ? "month" : "web";

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          active: true,
          plan,
          status: sub.status,
          // Newer Stripe API versions moved current_period_end onto the
          // subscription item, so fall back to the item's value.
          currentPeriodEnd:
            (sub.current_period_end || (item && item.current_period_end) || 0) * 1000, // seconds → ms
        }),
      };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ active: false }) };
  } catch (err) {
    // Fail SAFE: on any error we return a non-200 so the app leaves premium
    // exactly as it was rather than wrongly locking a paying customer out.
    return { statusCode: 502, headers, body: JSON.stringify({ error: "lookup failed" }) };
  }
};
