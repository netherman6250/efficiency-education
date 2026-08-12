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

// Returns "ok", "admin_not_set", or "bad_password".
async function verifyAdmin(s, password) {
  const cred = await getJSON(s, ADMIN_KEY);
  if (!cred || !cred.hash) return "admin_not_set";
  const a = Buffer.from(sha(String(password || "")));
  const b = Buffer.from(cred.hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return "bad_password";
  return "ok";
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

    // ---- admin: list everyone (with banned flag) --------------------------
    if (action === "list") {
      const v = await verifyAdmin(s, body.password);
      if (v !== "ok") return ok(headers, { ok: false, error: v });

      const listing = await s.list({ prefix: "visitor_" });
      const keys = (listing && listing.blobs) || [];
      const visitors = [];
      for (const bl of keys) {
        const r = await getJSON(s, bl.key);
        if (r) {
          r.banned = !!(await getJSON(s, "ban_" + sha((r.email || "").trim().toLowerCase())));
          visitors.push(r);
        }
      }
      visitors.sort((x, y) => (y.lastActive || 0) - (x.lastActive || 0));
      return ok(headers, { ok: true, visitors });
    }

    // ---- admin: ban / unban an account ------------------------------------
    if (action === "ban" || action === "unban") {
      const v = await verifyAdmin(s, body.password);
      if (v !== "ok") return ok(headers, { ok: false, error: v });
      const email = (body.email || "").trim().toLowerCase();
      if (!email || email.indexOf("@") < 0) return ok(headers, { ok: false, error: "email required" });
      const key = "ban_" + sha(email);
      if (action === "ban") await s.setJSON(key, { email, at: Date.now() });
      else await s.delete(key);
      return ok(headers, { ok: true });
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "unknown_action" }) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "server_error" }) };
  }
};
