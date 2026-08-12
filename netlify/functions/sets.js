// sets.js  —  Netlify serverless function
// -----------------------------------------------------------------------------
// Sharing of custom question sets, plus a ban check.
//
//   POST { action:"publish", email, name, subject, cards:[{prompt,answer,subject}] }
//        -> { ok:true, code:"4F9K2A" }   (rejected if the account is banned or rate-limited)
//   POST { action:"get", code }          -> { ok:true, set:{name,subject,cards} } | { ok:false }
//   POST { action:"status", email }      -> { banned: true|false }
// -----------------------------------------------------------------------------

const { getStore, connectLambda } = require("@netlify/blobs");
const crypto = require("crypto");

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const store = () => getStore("efficiency-education");

async function getJSON(s, key) { try { return await s.get(key, { type: "json" }); } catch (e) { return null; } }
function ok(headers, obj) { return { statusCode: 200, headers, body: JSON.stringify(obj) }; }

async function isBanned(s, email) {
  email = (email || "").trim().toLowerCase();
  if (!email) return false;
  return !!(await getJSON(s, "ban_" + sha(email)));
}
// Best-effort per-IP rate limit (eventual consistency makes it approximate, but it
// still catches sustained floods). Returns true if the request is allowed.
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
    if (action === "status") {
      return ok(headers, { banned: await isBanned(s, body.email) });
    }

    if (action === "publish") {
      if (await isBanned(s, body.email)) return ok(headers, { ok: false, error: "restricted" });
      if (!(await underLimit(s, clientIp(event), "pub", 12)))
        return { statusCode: 429, headers, body: JSON.stringify({ error: "rate_limited" }) };

      const name = String(body.name || "Shared set").slice(0, 120);
      const subject = String(body.subject || "General").slice(0, 40);
      let cards = Array.isArray(body.cards) ? body.cards : [];
      cards = cards.slice(0, 500)
        .map((c) => ({
          prompt: String((c && c.prompt) || "").slice(0, 2000),
          answer: String((c && c.answer) || "").slice(0, 2000),
          subject: String((c && c.subject) || subject).slice(0, 40),
        }))
        .filter((c) => c.prompt);
      if (!cards.length) return ok(headers, { ok: false, error: "empty" });

      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      await s.setJSON("set_" + code, {
        name, subject, cards,
        by: (body.email || "").trim().toLowerCase() || "anonymous",
        date: Date.now(),
      });
      return ok(headers, { ok: true, code });
    }

    if (action === "get") {
      const code = String(body.code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
      if (!code) return ok(headers, { ok: false, error: "bad_code" });
      const rec = await getJSON(s, "set_" + code);
      if (!rec) return ok(headers, { ok: false, error: "not_found" });
      return ok(headers, { ok: true, set: { name: rec.name, subject: rec.subject, cards: rec.cards } });
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "unknown_action" }) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "server_error" }) };
  }
};
