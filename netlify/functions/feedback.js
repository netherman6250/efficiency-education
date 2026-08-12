// feedback.js  —  Netlify serverless function
// -----------------------------------------------------------------------------
// Collects user feedback into Netlify Blobs and lets the admin read it.
//
//   POST { action:"submit", email, message }   -> { ok:true }
//   POST { action:"list",   password }         (admin only — verifies admin password)
//        -> { ok:true, feedback:[ { email, message, date }, ... ] }
//        -> { ok:false, error:"bad_password" | "admin_not_set" }
// -----------------------------------------------------------------------------

const { getStore, connectLambda } = require("@netlify/blobs");
const crypto = require("crypto");

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const store = () => getStore("efficiency-education");
const ADMIN_KEY = "admin_cred";   // same key admin-auth.js writes

async function getJSON(s, key) {
  try { return await s.get(key, { type: "json" }); } catch (e) { return null; }
}
function ok(headers, obj) { return { statusCode: 200, headers, body: JSON.stringify(obj) }; }

async function isBanned(s, email) {
  email = (email || "").trim().toLowerCase();
  if (!email) return false;
  return !!(await getJSON(s, "ban_" + sha(email)));
}
async function underLimit(s, ip, bucket, maxPerMin) {
  if (!ip) return true;
  const key = "rl_" + bucket + "_" + sha(ip);
  const now = Date.now();
  const rec = (await getJSON(s, key)) || { count: 0, start: now };
  if (now - rec.start > 60000) { rec.count = 0; rec.start = now; }
  rec.count++;
  await s.setJSON(key, rec);
  return rec.count <= maxPerMin;
}
function clientIp(event) {
  const h = event.headers || {};
  return (h["x-nf-client-connection-ip"] || (h["x-forwarded-for"] || "").split(",")[0] || "").trim();
}

exports.handler = async (event) => {
  connectLambda(event);
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };

  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Use POST" }) };

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) {}
  const action = String(body.action || "");
  const s = store();

  try {
    // ---- submit feedback ---------------------------------------------------
    if (action === "submit") {
      if (await isBanned(s, body.email)) return ok(headers, { ok: false, error: "restricted" });
      if (!(await underLimit(s, clientIp(event), "fb", 10)))
        return { statusCode: 429, headers, body: JSON.stringify({ error: "rate_limited" }) };
      const message = String(body.message || "").slice(0, 4000).trim();
      if (!message) return { statusCode: 400, headers, body: JSON.stringify({ error: "empty" }) };
      const email = String(body.email || "").trim().toLowerCase().slice(0, 200);
      const key = "feedback_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
      await s.setJSON(key, { email: email || "anonymous", message, date: Date.now() });
      return ok(headers, { ok: true });
    }

    // ---- admin: list feedback ---------------------------------------------
    if (action === "list") {
      const cred = await getJSON(s, ADMIN_KEY);
      if (!cred || !cred.hash) return ok(headers, { ok: false, error: "admin_not_set" });
      const a = Buffer.from(sha(String(body.password || "")));
      const b = Buffer.from(cred.hash);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
        return ok(headers, { ok: false, error: "bad_password" });

      const listing = await s.list({ prefix: "feedback_" });
      const keys = (listing && listing.blobs) || [];
      const feedback = [];
      for (const bl of keys) {
        const r = await getJSON(s, bl.key);
        if (r) feedback.push(r);
      }
      feedback.sort((x, y) => (y.date || 0) - (x.date || 0));
      return ok(headers, { ok: true, feedback });
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "unknown_action" }) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "server_error" }) };
  }
};
