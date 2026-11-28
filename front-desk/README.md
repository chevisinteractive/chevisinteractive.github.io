# Chevis Interactive front desk

An AI assistant for the Chevis Interactive website: it answers visitor
questions about services and prices from a fixed knowledge file, and captures
inquiries for the studio inbox. This is the product the site sells as the
$299 AI Setup, running on the studio's own site first.

## The three pieces

1. **The brain** (`brain.md`): the assistant's complete knowledge and rules,
   written from the live site's own copy. Services, real prices ($2,500
   website build, $199/mo Care Plan, $299 AI Setup, free with a build), what
   a build includes, the process, and the non-negotiable rules: answer only
   from the brain, never invent facts, never give out a phone number,
   identify as an AI, offer the lead form when a question is outside the
   brain.
2. **The middleman** (`worker.js`, this folder): a Cloudflare Worker. The
   browser posts the conversation to it; it adds the brain as the Gemini
   system instruction, calls Google Gemini (`gemini-2.5-flash`,
   generateContent), caps history and reply length, soft rate-limits per IP,
   and returns `{ reply, showLeadForm }`. CORS allows only
   `https://chevisinteractive.github.io` and
   `https://chevisinteractive.pages.dev`.
3. **The widget** (`assets/front-desk.js` and `assets/front-desk.css` in the
   repo root's assets folder): the chat panel on the site, in the site's
   bright Apple language. It talks to the Worker endpoint configured at the
   top of `front-desk.js`, and its lead form posts to FormSubmit
   (`https://formsubmit.co/ajax/chevisinteractive@gmail.com`), the same pipe
   as the site's project form. FormSubmit mail lands in the studio inbox's
   Spam folder; check there.

## How the lead form moment works

When the assistant offers to take a visitor's details, `brain.md` tells it to
end its reply with `[[LEAD_FORM]]` on its own line. The Worker strips the
marker and returns `showLeadForm: true`; the widget then shows the name,
email, and need fields under the conversation. The visitor can also open the
form at any time with the "Leave your details" button.

## Local testing (no key needed)

The Worker logic runs under plain Node with the Gemini call stubbed; see the
build report for the exact harness used and its results. To re-run:

1. Copy `worker.js` to a temp `.mjs` file, replacing the line
   `import BRAIN from "./brain.md";` with a const holding the brain text.
2. Import it in a test script, stub `globalThis.fetch` to answer the Gemini
   URL with a canned generateContent response, and call
   `worker.fetch(request, { GEMINI_API_KEY: "test" })`.

The widget can be tested by serving the repo root with any static server
(`python3 -m http.server`) and pointing `WORKER_ENDPOINT` in
`assets/front-desk.js` at a local stub that returns `{ reply, showLeadForm }`.

## Go-live checklist (not done yet)

1. Create a fresh Gemini API key in Google AI Studio. Do not reuse any key
   that has ever been committed anywhere.
2. From this folder: `wrangler secret put GEMINI_API_KEY` and paste the key.
3. `wrangler deploy`. Note the deployed Worker URL.
4. Set `WORKER_ENDPOINT` at the top of `assets/front-desk.js` to that URL.
5. Patrick reviews the assistant's answers on the branch preview.
6. Merge the `ai-front-desk` branch to `main`.

Until step 6, nothing here is live: the widget is only wired into
`index.html` on the `ai-front-desk` branch.
