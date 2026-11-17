/* Chevis quick chat — chat / lead-capture widget for chevisinteractive.github.io.
   Fully static. Quick answers come from the local knowledge base below
   (scripted, instant, no backend and no API keys). Lead capture posts to
   FormSubmit (zero-cost static form endpoint for the studio inbox); if
   that endpoint is unavailable or not yet activated, it falls back to a
   prefilled email in the visitor's own mail app. Nothing here phones
   home anywhere else. */
(function () {
  "use strict";

  var STUDIO_EMAIL = "chevisinteractive@gmail.com";
  var FORMSUBMIT_AJAX = "https://formsubmit.co/ajax/" + STUDIO_EMAIL;

  /* ---------- knowledge base (prices as decided 2026-11-17) ---------- */
  var ANSWERS = {
    build:
      "We build two things:\n\n" +
      "• Websites for local businesses — designed, built, and looked after month to month.\n" +
      "• Games and apps for Android — Royal Spades, Royal Stacks, and Tome, all made in-house.\n\n" +
      "Tap “What's the AI Setup?” for the newest thing we offer, or use the form below and we will email you back.",
    cost:
      "Straight numbers:\n\n" +
      "• A website build starts at <span class=\"price\">$2,500</span> — design, build, hosting and domain set up, your review before anything goes live.\n" +
      "• The Care Plan is <span class=\"price\">$199/mo</span> after launch — hosting management, updates and small edits done for you, backups, and a short monthly report.\n" +
      "• The AI Setup is <span class=\"price\">$299</span> one time — and free with any website build.\n\n" +
      "You own the website and the domain. If you ever leave, they go with you.",
    ai:
      "The AI Setup is a smart chat and lead-capture widget for your own website — this very chat is one, running on our site.\n\n" +
      "It answers your customers' common questions instantly, day or night, and captures the name, email, and details of anyone who wants a callback, straight to your inbox. No backend, nothing for you to maintain.\n\n" +
      "It is <span class=\"price\">$299</span> one time — and free with any website build. After that it is looked after under the Care Plan, <span class=\"price\">$199/mo</span>.",
    games:
      "Three titles, one standard:\n\n" +
      "• Royal Spades — the classic card game, dealt properly. Free on Google Play, with a playable demo right in your browser.\n" +
      "• Royal Stacks — a poker roguelike deck-builder. Crown your face cards, fuse your jokers, and climb the court. Supporter Edition on itch.io.\n" +
      "• Tome — an audiobook player for the library you already own, streaming your audiobooks from your own Google Drive. Coming soon.\n\n" +
      "The games are all on the home page if you want a closer look.",
    contact:
      "The studio reads its own email: " + STUDIO_EMAIL + ".\n\n" +
      "Or tap “Start a project” below and leave your details here — it lands in the same inbox.",
    fallback:
      "That one is beyond my scripted answers. Two good options:\n\n" +
      "• Tap “Start a project” and leave your details — a human at the studio will email you back.\n" +
      "• Or email us directly at " + STUDIO_EMAIL + "."
  };

  var CHIPS = [
    { label: "What do you build?", key: "build" },
    { label: "What does a website cost?", key: "cost" },
    { label: "What's the AI Setup?", key: "ai" },
    { label: "Tell me about your games", key: "games" },
    { label: "Start a project →", key: "lead", cta: true }
  ];

  /* keyword routing for typed questions */
  var ROUTES = [
    { key: "cost", words: ["cost", "price", "pricing", "much", "quote", "charge", "fee", "$"] },
    { key: "ai", words: ["ai", "chatbot", "chat bot", "widget", "lead", "setup", "bot"] },
    { key: "games", words: ["game", "spades", "stacks", "tome", "audiobook", "android", "play", "itch"] },
    { key: "contact", words: ["contact", "email", "human", "person", "talk", "call", "phone", "reach"] },
    { key: "build", words: ["build", "website", "site", "web", "service", "offer", "do you do", "make"] }
  ];

  function route(text) {
    var t = " " + text.toLowerCase() + " ";
    for (var i = 0; i < ROUTES.length; i++) {
      var words = ROUTES[i].words;
      for (var j = 0; j < words.length; j++) {
        if (t.indexOf(words[j]) !== -1) return ROUTES[i].key;
      }
    }
    return null;
  }

  /* ---------- DOM ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var launcher = el("button", "chevis-chat-launcher");
  launcher.type = "button";
  launcher.setAttribute("aria-haspopup", "dialog");
  launcher.setAttribute("aria-expanded", "false");
  launcher.innerHTML =
    '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>' +
    "<span>Chat with us</span>";

  var panel = el("section", "chevis-chat-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Chevis quick chat");
  panel.setAttribute("aria-hidden", "true");

  var head = el("div", "chevis-chat-head");
  var headImg = document.createElement("img");
  headImg.src = "assets/chevis-monogram.png";
  headImg.alt = "";
  headImg.width = 200; headImg.height = 170;
  var headText = el("div");
  var h2 = el("h2", null, "Chevis quick chat");
  var headSub = el("p", null, "Instant answers to common questions, straight from the studio. Not a live person — leave your details and we will email you back.");
  headText.appendChild(h2); headText.appendChild(headSub);
  var closeBtn = el("button", "chevis-chat-close", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close chat");
  head.appendChild(headImg); head.appendChild(headText); head.appendChild(closeBtn);

  var log = el("div", "chevis-chat-log");
  log.setAttribute("aria-live", "polite");

  var chipsRow = el("div", "chevis-chat-chips");
  var inputRow = el("form", "chevis-chat-inputrow");
  var input = el("input", "chevis-chat-input");
  input.type = "text";
  input.placeholder = "Ask about websites, prices, games…";
  input.setAttribute("aria-label", "Type a question");
  input.setAttribute("autocomplete", "off");
  var sendBtn = el("button", "chevis-chat-send", "Send");
  sendBtn.type = "submit";
  inputRow.appendChild(input); inputRow.appendChild(sendBtn);

  panel.appendChild(head);
  panel.appendChild(log);
  panel.appendChild(chipsRow);
  panel.appendChild(inputRow);

  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  /* ---------- chat behaviour ---------- */
  var greeted = false;
  var formOpen = false;

  function scrollLog() { log.scrollTop = log.scrollHeight; }

  function addMsg(text, who, isHTML) {
    var m = el("div", "chevis-chat-msg " + who);
    if (isHTML) m.innerHTML = text; else m.textContent = text;
    log.appendChild(m);
    scrollLog();
    return m;
  }

  function renderChips() {
    chipsRow.innerHTML = "";
    CHIPS.forEach(function (chip) {
      var b = el("button", "chevis-chat-chip" + (chip.cta ? " cta" : ""), chip.label);
      b.type = "button";
      b.addEventListener("click", function () {
        if (chip.key === "lead") { showLeadForm(); return; }
        addMsg(chip.label, "user");
        window.setTimeout(function () { addMsg(ANSWERS[chip.key], "bot", true); }, 180);
      });
      chipsRow.appendChild(b);
    });
  }

  function greet() {
    if (greeted) return;
    greeted = true;
    addMsg(
      "Hello — this is the studio's quick chat. It answers the questions we get most, instantly, and takes your details if you would like a callback.\n\nWhat can it help with?",
      "bot"
    );
    renderChips();
  }

  function answer(text) {
    var key = route(text);
    addMsg(key ? ANSWERS[key] : ANSWERS.fallback, "bot", true);
  }

  inputRow.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    addMsg(text, "user");
    window.setTimeout(function () { answer(text); }, 180);
  });

  /* ---------- lead capture ---------- */
  function showLeadForm() {
    if (formOpen) { input.focus(); return; }
    formOpen = true;
    chipsRow.style.display = "none";
    inputRow.style.display = "none";

    var wrap = el("div", "chevis-chat-msg bot");
    wrap.style.maxWidth = "94%";
    var form = el("form", "chevis-chat-form");
    form.setAttribute("novalidate", "");

    var intro = el("p", "chevis-chat-status");
    intro.innerHTML = "<strong>Tell us what you need.</strong> This goes straight to the studio inbox and we reply by email.";
    form.appendChild(intro);

    function field(labelText, control) {
      var l = el("label", null, labelText);
      l.appendChild(control);
      return l;
    }
    var nameIn = el("input"); nameIn.type = "text"; nameIn.name = "name"; nameIn.required = true; nameIn.autocomplete = "name";
    var emailIn = el("input"); emailIn.type = "email"; emailIn.name = "email"; emailIn.required = true; emailIn.autocomplete = "email";
    var needSel = el("select"); needSel.name = "need";
    ["Website", "AI Setup", "App or game", "Other"].forEach(function (opt) {
      var o = el("option", null, opt); o.value = opt; needSel.appendChild(o);
    });
    var msgIn = el("textarea"); msgIn.name = "message"; msgIn.required = true;
    msgIn.placeholder = "A line or two about your business or idea…";

    form.appendChild(field("Your name", nameIn));
    form.appendChild(field("Your email", emailIn));
    form.appendChild(field("What do you need?", needSel));
    form.appendChild(field("Message", msgIn));

    var submit = el("button", "chevis-chat-send", "Send to the studio");
    submit.type = "submit";
    form.appendChild(submit);

    var status = el("p", "chevis-chat-status");
    form.appendChild(status);

    var back = el("button", "chevis-chat-back", "← Back to quick answers");
    back.type = "button";
    back.addEventListener("click", function () {
      wrap.remove();
      formOpen = false;
      chipsRow.style.display = "";
      inputRow.style.display = "";
      renderChips();
      scrollLog();
    });
    form.appendChild(back);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = nameIn.value.trim(), email = emailIn.value.trim(), msg = msgIn.value.trim();
      if (!name || !email || !msg || email.indexOf("@") === -1) {
        status.textContent = "Please add your name, a valid email, and a short message — then we can reply properly.";
        return;
      }
      submit.disabled = true;
      submit.textContent = "Sending…";
      status.textContent = "";

      var payload = {
        name: name,
        email: email,
        need: needSel.value,
        message: msg,
        _subject: "Website enquiry from " + name + " (" + needSel.value + ")",
        _template: "table",
        _captcha: "false"
      };

      function mailtoFallback() {
        var subject = "Website enquiry from " + name + " (" + needSel.value + ")";
        var body =
          "Name: " + name + "\nEmail: " + email + "\nI need: " + needSel.value + "\n\n" + msg;
        status.innerHTML =
          "<strong>One more tap:</strong> the form service is not reachable just now, so your email app will open with everything filled in — just press send there.";
        submit.disabled = false;
        submit.textContent = "Open my email app instead";
        submit.onclick = function () {
          window.location.href =
            "mailto:" + STUDIO_EMAIL +
            "?subject=" + encodeURIComponent(subject) +
            "&body=" + encodeURIComponent(body);
        };
      }

      if (!window.fetch) { mailtoFallback(); return; }
      fetch(FORMSUBMIT_AJAX, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload)
      })
        .then(function (r) { return r.json().catch(function () { return null; }); })
        .then(function (data) {
          if (data && (data.success === true || data.success === "true")) {
            form.innerHTML = "";
            var done = el("p", "chevis-chat-status");
            done.innerHTML =
              "<strong>Sent — thank you, " + name.split(" ")[0] + ".</strong> Your details are in the studio inbox and we will reply to " +
              email + " in plain language, usually within a business day.";
            form.appendChild(done);
            form.appendChild(back);
          } else {
            mailtoFallback();
          }
        })
        .catch(mailtoFallback);
    });

    wrap.appendChild(form);
    log.appendChild(wrap);
    scrollLog();
    nameIn.focus();
  }

  /* ---------- open / close ---------- */
  var lastFocus = null;
  function openPanel() {
    lastFocus = document.activeElement;
    panel.classList.add("is-open");
    panel.setAttribute("aria-hidden", "false");
    launcher.classList.add("is-hidden");
    launcher.setAttribute("aria-expanded", "true");
    greet();
    window.setTimeout(function () { input.focus(); }, 60);
  }
  function closePanel() {
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    launcher.classList.remove("is-hidden");
    launcher.setAttribute("aria-expanded", "false");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  launcher.addEventListener("click", openPanel);
  closeBtn.addEventListener("click", closePanel);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && panel.classList.contains("is-open")) closePanel();
  });
})();
