// visitors.js  —  Netlify serverless function
// -----------------------------------------------------------------------------
// A central, cross-device visitor log so the admin can see everyone who signs
// in — not just accounts saved in the admin's own browser. Stored in Netlify
// Blobs, one record per email.
//
//   POST { action:"log",  email, stats:{ sets, attempts, avg, premium } }
//        -> { ok:true }                    (called by the app on sign-in)
//   POST { action:"list", password }       (admin only — verifies the admin password)
//        -> { ok:true, visitors:[ { email, lastActive, sets, attempts, avg, premium }, ... ] }
//        -> { ok:false, error:"bad_password" | "admin_not_set" }
//
// The list is protected because it exposes user emails.
// -----------------------------------------------------------------------------

const { getStore, connectLambda } = require("@netlify/blobs");
const crypto = require("crypto");

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const store = () => getStore("efficiency-education");
const VKEY = (email) => "visitor_" + sha(email);
const ADMIN_KEY = "admin_cred";   // same key admin-auth.js writes

async function getJSON(s, key) {
  try { return await s.get(key, { type: "json" }); } catch (e) { return null; }
}
function ok(headers, obj) { return { statusCode: 200, headers, body: JSON.stringify(obj) }; }
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

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
    // ---- record a sign-in --------------------------------------------------
    if (action === "log") {
      const email = (body.email || "").trim().toLowerCase();
      if (!email || email.indexOf("@") < 0)
        return { statusCode: 400, headers, body: JSON.stringify({ error: "email required" }) };
      const st = body.stats || {};
      await s.setJSON(VKEY(email), {
        email,
        lastActive: Date.now(),
        sets: num(st.sets),
        attempts: num(st.attempts),
        avg: num(st.avg),
        premium: !!st.premium,
      });
      return ok(headers, { ok: true });
    }

    // ---- admin: list everyone ---------------------------------------------
    if (action === "list") {
      const cred = await getJSON(s, ADMIN_KEY);
      if (!cred || !cred.hash) return ok(headers, { ok: false, error: "admin_not_set" });
      const a = Buffer.from(sha(String(body.password || "")));
      const b = Buffer.from(cred.hash);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
        return ok(headers, { ok: false, error: "bad_password" });

      const listing = await s.list({ prefix: "visitor_" });
      const keys = (listing && listing.blobs) || [];
      const visitors = [];
      for (const bl of keys) {
        const r = await getJSON(s, bl.key);
        if (r) visitors.push(r);
      }
      visitors.sort((x, y) => (y.lastActive || 0) - (x.lastActive || 0));
      return ok(headers, { ok: true, visitors });
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "unknown_action" }) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "server_error" }) };
  }
};
