// admin-auth.js  —  Netlify serverless function
// -----------------------------------------------------------------------------
// Server-side admin credential. Fixes the old per-device "set password on first
// use" hole: the password now lives in Netlify Blobs (shared across every
// device), and *setting* it requires a one-time bootstrap secret that only the
// site owner holds (the ADMIN_BOOTSTRAP_SECRET env var). A fresh browser can no
// longer self-grant admin.
//
//   POST { action:"status" }                       -> { isSet:bool }
//   POST { action:"set", bootstrapSecret, password } -> { ok:bool, error? }
//   POST { action:"verify", password }             -> { ok:bool, error? }
//
// Only a SHA-256 hash of the password is stored.
// -----------------------------------------------------------------------------

const { getStore, connectLambda } = require("@netlify/blobs");
const crypto = require("crypto");

const ADMIN_KEY = "admin_cred";
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const store = () => getStore("efficiency-education");

async function getJSON(s, key) {
  try { return await s.get(key, { type: "json" }); } catch (e) { return null; }
}
function ok(headers, obj) { return { statusCode: 200, headers, body: JSON.stringify(obj) }; }
// Constant-length comparison (hash both sides so lengths always match).
function safeEqHashed(a, b) {
  const ba = Buffer.from(sha(a)), bb = Buffer.from(sha(b));
  return crypto.timingSafeEqual(ba, bb);
}

exports.handler = async (event) => {
  connectLambda(event);   // required for Netlify Blobs in a classic (event) handler
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };

  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Use POST" }) };

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) {}
  const action = String(body.action || "");
  const s = store();

  try {
    const cred = await getJSON(s, ADMIN_KEY);

    if (action === "status") return ok(headers, { isSet: !!cred });

    if (action === "set") {
      const secret = process.env.ADMIN_BOOTSTRAP_SECRET;
      if (!secret) return { statusCode: 500, headers, body: JSON.stringify({ error: "not_configured" }) };
      if (!safeEqHashed(String(body.bootstrapSecret || ""), secret))
        return ok(headers, { ok: false, error: "bad_secret" });
      const pw = String(body.password || "");
      if (pw.length < 6) return ok(headers, { ok: false, error: "weak" });
      await s.setJSON(ADMIN_KEY, { hash: sha(pw) });
      return ok(headers, { ok: true });
    }

    if (action === "verify") {
      if (!cred || !cred.hash) return ok(headers, { ok: false, error: "not_set" });
      const a = Buffer.from(sha(String(body.password || "")));
      const b = Buffer.from(cred.hash);
      const match = a.length === b.length && crypto.timingSafeEqual(a, b);
      return ok(headers, { ok: match });
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "unknown_action" }) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "server_error" }) };
  }
};
