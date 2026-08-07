// device-verify.js  —  Netlify serverless function
// -----------------------------------------------------------------------------
// New-device verification for PREMIUM accounts. The app only calls this when
// Stripe already says the email is an active subscriber; the goal is to stop a
// premium account from being shared by email alone.
//
//   POST { action:"check",   email, deviceId }
//        -> { trusted:true }                 device already trusted
//        -> { trusted:true, firstDevice:true } first device ever, auto-trusted
//        -> { trusted:false }                 known account, unrecognised device
//   POST { action:"request", email, deviceId }  -> emails a 6-digit code
//        -> { sent:true } | { sent:true, throttled:true }
//   POST { action:"confirm", email, deviceId, code }
//        -> { trusted:true } | { trusted:false, error:"wrong|expired|no_code|too_many" }
//
// State lives in Netlify Blobs (built in, no extra service). The code is stored
// only as a salted SHA-256 hash and expires after 10 minutes.
// -----------------------------------------------------------------------------

const { getStore, connectLambda } = require("@netlify/blobs");
const crypto = require("crypto");

const CODE_TTL_MS = 10 * 60 * 1000;    // code valid for 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000;  // don't re-send within 60s
const MAX_ATTEMPTS = 5;                // wrong-code attempts before the code is burned

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const store = () => getStore("efficiency-education");
const devKey = (email) => "dev_" + sha(email);
const codeKey = (email, deviceId) => "code_" + sha(email) + "_" + deviceId;

async function getJSON(s, key) {
  // Eventual consistency (the classic-function environment doesn't support strong
  // reads). Fine here: device checks and code entry happen long after the write.
  try { return await s.get(key, { type: "json" }); } catch (e) { return null; }
}
function ok(headers, obj) { return { statusCode: 200, headers, body: JSON.stringify(obj) }; }
function safeEq(a, b) {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

exports.handler = async (event) => {
  connectLambda(event);   // required for Netlify Blobs in a classic (event) handler
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };

  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Use POST" }) };

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) {}

  const action = String(body.action || "");
  const email = (body.email || "").trim().toLowerCase();
  const deviceId = String(body.deviceId || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 64);

  if (!email || email.indexOf("@") < 0 || !deviceId)
    return { statusCode: 400, headers, body: JSON.stringify({ error: "email and deviceId required" }) };

  const s = store();
  const dKey = devKey(email);

  try {
    // ---- is this device trusted? -------------------------------------------
    if (action === "check") {
      const rec = (await getJSON(s, dKey)) || { trusted: [] };
      if (rec.trusted.includes(deviceId)) return ok(headers, { trusted: true });
      if (rec.trusted.length === 0) {
        // First device we've ever seen for this account — trust it silently so
        // the person who bought/first signed in isn't asked for a code.
        rec.trusted.push(deviceId);
        await s.setJSON(dKey, rec);
        return ok(headers, { trusted: true, firstDevice: true });
      }
      return ok(headers, { trusted: false });
    }

    // ---- email a fresh code ------------------------------------------------
    if (action === "request") {
      const cKey = codeKey(email, deviceId);
      const existing = await getJSON(s, cKey);
      if (existing && Date.now() - (existing.created || 0) < RESEND_COOLDOWN_MS)
        return ok(headers, { sent: true, throttled: true });

      const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      await s.setJSON(cKey, {
        codeHash: sha(code + ":" + email),
        exp: Date.now() + CODE_TTL_MS,
        created: Date.now(),
        attempts: 0,
      });
      const sent = await sendEmail(email, code);
      if (!sent) return { statusCode: 502, headers, body: JSON.stringify({ error: "email_failed" }) };
      return ok(headers, { sent: true });
    }

    // ---- confirm a code ----------------------------------------------------
    if (action === "confirm") {
      const code = String(body.code || "").replace(/\D/g, "");
      const cKey = codeKey(email, deviceId);
      const rec = await getJSON(s, cKey);
      if (!rec) return ok(headers, { trusted: false, error: "no_code" });
      if (Date.now() > rec.exp) { await s.delete(cKey); return ok(headers, { trusted: false, error: "expired" }); }
      if ((rec.attempts || 0) >= MAX_ATTEMPTS) { await s.delete(cKey); return ok(headers, { trusted: false, error: "too_many" }); }

      if (!safeEq(sha(code + ":" + email), rec.codeHash)) {
        rec.attempts = (rec.attempts || 0) + 1;
        await s.setJSON(cKey, rec);
        return ok(headers, { trusted: false, error: "wrong" });
      }

      const drec = (await getJSON(s, dKey)) || { trusted: [] };
      if (!drec.trusted.includes(deviceId)) drec.trusted.push(deviceId);
      await s.setJSON(dKey, drec);
      await s.delete(cKey);
      return ok(headers, { trusted: true });
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "unknown_action" }) };
  } catch (err) {
    // Fail SAFE: the app treats any error here as "leave premium as-is", so an
    // outage never locks a paying customer out (it also never grants on error).
    return { statusCode: 502, headers, body: JSON.stringify({ error: "server_error" }) };
  }
};

// --- email delivery (Resend) -------------------------------------------------
// Swap this one function to use a different email provider. Requires the
// RESEND_API_KEY env var; MAIL_FROM must be an address on a domain you've
// verified in Resend (or "onboarding@resend.dev" for testing to your own inbox).
async function sendEmail(to, code) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM || "Efficiency Education <onboarding@resend.dev>";
  if (!key) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject: "Your Efficiency Education verification code",
        text:
          "Your verification code is " + code + ".\n\n" +
          "It expires in 10 minutes. Enter it on the new device to unlock premium.\n\n" +
          "If you didn't try to sign in, you can ignore this email — nothing has changed.",
      }),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}
