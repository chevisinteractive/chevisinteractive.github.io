/* Chevis Interactive front desk: the middleman.
 *
 * A Cloudflare Worker that sits between the website chat widget
 * (assets/front-desk.js) and Google Gemini. The browser never sees the API
 * key: the widget posts the conversation here, this Worker adds the brain
 * (front-desk/brain.md, imported as text by the wrangler rule in
 * wrangler.toml) as the system instruction, calls Gemini, and returns a
 * plain { reply } JSON.
 *
 * Contract:
 *   Request:  POST JSON { messages: [ { role: "user" | "assistant",
 *                                        text: "..." }, ... ] }
 *   Response: { reply: "...", showLeadForm: true | false }
 *             showLeadForm is true when the assistant ended its reply with
 *             the [[LEAD_FORM]] marker defined in brain.md. The marker is
 *             stripped before the reply reaches the visitor.
 *
 * The Gemini API key is read from the Worker secret GEMINI_API_KEY
 * (wrangler secret put GEMINI_API_KEY). It is never hardcoded here.
 *
 * Deploy: see front-desk/README.md. Not deployed yet.
 */

import BRAIN from "./brain.md";

/* ---------- config ---------- */

/* Origins allowed to call this Worker. The live site and its Cloudflare
   Pages preview origin. Add branch preview origins here if needed, in the
   exact "https://host" form. */
const ALLOWED_ORIGINS = [
  "https://chevisinteractive.github.io",
  "https://chevisinteractive.pages.dev",
];

/* Model chain: the primary answers; if it refuses or fails (quota,
   overload, network), the backup answers instead. Each model carries its
   own per-project daily quota, so the fallback message only shows when
   every lane is down. Both lanes passed the hostile-customer battery
   against this brain (2026-11-27). */
const GEMINI_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
function geminiUrl(model) {
  return (
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    model +
    ":generateContent"
  );
}

const MAX_MESSAGES = 12; /* conversation turns forwarded to Gemini */
const MAX_MESSAGE_CHARS = 1000; /* per message */
const MAX_TOTAL_CHARS = 6000; /* whole forwarded history */
const MAX_OUTPUT_TOKENS = 400; /* Gemini side reply cap */
const MAX_REPLY_CHARS = 1500; /* hard slice on what we return */
const LEAD_MARKER = "[[LEAD_FORM]]";

/* Cheap per-IP soft rate limit: an in-memory counter per Worker instance.
   Not exact across instances, and that is fine for a front desk. */
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const rateBuckets = new Map();

const FALLBACK_REPLY =
  "Sorry, I cannot reach my answering service just now. You can email the " +
  "studio directly at chevisinteractive@gmail.com, or leave your name, " +
  "email, and what you need here and the studio will follow up within one " +
  "business day.";

const RATE_LIMIT_REPLY =
  "You have sent a lot of messages in a short stretch, so I am pausing for " +
  "a bit. For anything urgent, email the studio at " +
  "chevisinteractive@gmail.com and they will reply within one business day.";

/* ---------- helpers ---------- */

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign(
      { "Content-Type": "application/json" },
      origin ? corsHeaders(origin) : {}
    ),
  });
}

function rateLimited(ip) {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.start > RATE_LIMIT_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  /* keep the map from growing without bound on a long-lived instance */
  if (rateBuckets.size > 5000) rateBuckets.clear();
  return bucket.count > RATE_LIMIT_MAX;
}

/* Validate and trim the incoming conversation into Gemini contents. */
function toContents(messages) {
  if (!Array.isArray(messages)) return null;
  const cleaned = [];
  for (const m of messages) {
    if (!m || typeof m.text !== "string") continue;
    const text = m.text.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!text) continue;
    cleaned.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text }],
    });
  }
  const recent = cleaned.slice(-MAX_MESSAGES);
  /* enforce the total budget from the newest end */
  let total = 0;
  const budgeted = [];
  for (let i = recent.length - 1; i >= 0; i--) {
    const len = recent[i].parts[0].text.length;
    if (total + len > MAX_TOTAL_CHARS && budgeted.length > 0) break;
    total += len;
    budgeted.unshift(recent[i]);
  }
  if (budgeted.length === 0) return null;
  if (budgeted[budgeted.length - 1].role !== "user") return null;
  return budgeted;
}

/* ---------- the worker ---------- */

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = ALLOWED_ORIGINS.includes(origin);

    if (request.method === "OPTIONS") {
      if (!allowed) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") {
      return json({ reply: FALLBACK_REPLY, showLeadForm: true }, 405, allowed ? origin : null);
    }
    if (!allowed) {
      return json({ reply: FALLBACK_REPLY, showLeadForm: true }, 403, null);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (rateLimited(ip)) {
      return json({ reply: RATE_LIMIT_REPLY, showLeadForm: true }, 429, origin);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ reply: FALLBACK_REPLY, showLeadForm: true }, 400, origin);
    }
    const contents = toContents(body && body.messages);
    if (!contents) {
      return json({ reply: FALLBACK_REPLY, showLeadForm: true }, 400, origin);
    }

    if (!env || !env.GEMINI_API_KEY) {
      console.error("front-desk: GEMINI_API_KEY secret is not set");
      return json({ reply: FALLBACK_REPLY, showLeadForm: true }, 200, origin);
    }

    const payload = JSON.stringify({
      system_instruction: { parts: [{ text: BRAIN }] },
      contents: contents,
      generationConfig: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.4,
      },
    });
    for (const model of GEMINI_MODELS) {
      try {
        const res = await fetch(geminiUrl(model), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": env.GEMINI_API_KEY,
          },
          body: payload,
        });
        if (!res.ok) {
          console.error(
            "front-desk: " + model + " returned HTTP " + res.status
          );
          continue;
        }
        const data = await res.json();
        const parts =
          data &&
          data.candidates &&
          data.candidates[0] &&
          data.candidates[0].content &&
          data.candidates[0].content.parts;
        let reply = "";
        if (Array.isArray(parts)) {
          reply = parts
            .map((p) => (p && typeof p.text === "string" ? p.text : ""))
            .join("")
            .trim();
        }
        if (!reply) continue;
        const showLeadForm = reply.includes(LEAD_MARKER);
        if (showLeadForm) reply = reply.split(LEAD_MARKER).join("").trim();
        reply = reply.slice(0, MAX_REPLY_CHARS);
        return json({ reply: reply, showLeadForm: showLeadForm }, 200, origin);
      } catch (e) {
        console.error(
          "front-desk: " + model + " call failed: " + (e && e.message)
        );
      }
    }
    return json({ reply: FALLBACK_REPLY, showLeadForm: true }, 200, origin);
  },
};
