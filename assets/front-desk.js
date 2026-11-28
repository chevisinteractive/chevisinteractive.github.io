/* Chevis AI front desk: the chat widget for chevisinteractive.github.io.
 *
 * A free-text chat panel backed by the front-desk Cloudflare Worker
 * (front-desk/worker.js), which talks to Google Gemini with the studio
 * knowledge file (front-desk/brain.md) as its instructions. This file holds
 * no API key and no answers: every reply comes from the Worker.
 *
 * Lead capture posts to FormSubmit, the same zero-cost endpoint the site's
 * project form uses (mail lands in the studio inbox, in Spam). If FormSubmit
 * is unreachable, the widget falls back to a prefilled email in the visitor's
 * own mail app.
 */
(function () {
  "use strict";

  /* ================================================================
     CONFIG: set this to the deployed front-desk Worker URL.
     Placeholder until the Worker is deployed (see front-desk/README.md).
     ================================================================ */
  var WORKER_ENDPOINT = "https://chevis-front-desk.chevisinteractive.workers.dev/";

  var STUDIO_EMAIL = "chevisinteractive@gmail.com";
  var FORMSUBMIT_AJAX = "https://formsubmit.co/ajax/" + STUDIO_EMAIL;

  var ERROR_REPLY =
    "Sorry, I cannot answer just now. You can email the studio at " +
    STUDIO_EMAIL +
    ", or use the Leave your details button below and the studio will " +
    "follow up within one business day.";

  /* Starter prompts: tapping one sends it as a normal message. The last
     entry opens the lead form instead. */
  var STARTERS = [
    "What does a website cost?",
    "What is included in a build?",
    "What is the Care Plan?",
    "What is the AI Setup?"
  ];

  /* ---------- DOM ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var launcher = el("button", "front-desk-launcher");
  launcher.type = "button";
  launcher.setAttribute("aria-haspopup", "dialog");
  launcher.setAttribute("aria-expanded", "false");
  launcher.innerHTML =
    '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>' +
    "<span>Ask the AI assistant</span>";

  var panel = el("section", "front-desk-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Chevis AI assistant");
  panel.setAttribute("aria-hidden", "true");

  var head = el("div", "front-desk-head");
  var headImg = document.createElement("img");
  headImg.src = "assets/chevis-monogram-gradient.png";
  headImg.alt = "";
  headImg.width = 38;
  headImg.height = 38;
  var headText = el("div", "front-desk-headtext");
  headText.appendChild(el("h2", null, "Chevis AI assistant"));
  headText.appendChild(
    el("p", null, "An AI assistant. It answers from our site, and takes your details for anything else.")
  );
  var closeBtn = el("button", "front-desk-close", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close chat");
  head.appendChild(headImg);
  head.appendChild(headText);
  head.appendChild(closeBtn);

  var log = el("div", "front-desk-log");
  log.setAttribute("aria-live", "polite");

  var chipsRow = el("div", "front-desk-chips");

  var leadSlot = el("div", "front-desk-leadslot");

  var inputRow = el("form", "front-desk-inputrow");
  var input = el("input", "front-desk-input");
  input.type = "text";
  input.placeholder = "Ask about websites, prices, care…";
  input.setAttribute("aria-label", "Type your question");
  input.maxLength = 1000;
  var sendBtn = el("button", "front-desk-send", "Send");
  sendBtn.type = "submit";
  inputRow.appendChild(input);
  inputRow.appendChild(sendBtn);

  panel.appendChild(head);
  panel.appendChild(log);
  panel.appendChild(chipsRow);
  panel.appendChild(leadSlot);
  panel.appendChild(inputRow);

  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  /* ---------- conversation state ---------- */
  var history = []; /* [{role: "user" | "assistant", text}] */
  var greeted = false;
  var busy = false;
  var formOpen = false;

  function scrollLog() {
    log.scrollTop = log.scrollHeight;
    window.setTimeout(function () {
      log.scrollTop = log.scrollHeight;
    }, 60);
  }

  function addMsg(text, who) {
    var m = el("div", "front-desk-msg " + who);
    m.textContent = text;
    log.appendChild(m);
    scrollLog();
    return m;
  }

  var typingEl = null;
  function showTyping() {
    hideTyping();
    typingEl = el("div", "front-desk-msg bot front-desk-typing");
    typingEl.setAttribute("aria-hidden", "true");
    typingEl.innerHTML = "<span></span><span></span><span></span>";
    log.appendChild(typingEl);
    scrollLog();
  }
  function hideTyping() {
    if (typingEl) {
      typingEl.remove();
      typingEl = null;
    }
  }

  function renderStarters() {
    chipsRow.innerHTML = "";
    STARTERS.forEach(function (q) {
      var b = el("button", "front-desk-chip", q);
      b.type = "button";
      b.addEventListener("click", function () {
        sendUserMessage(q);
      });
      chipsRow.appendChild(b);
    });
    var lead = el("button", "front-desk-chip cta", "Leave your details");
    lead.type = "button";
    lead.addEventListener("click", showLeadForm);
    chipsRow.appendChild(lead);
  }

  function greet() {
    if (greeted) return;
    greeted = true;
    var hello =
      "Hello, I am the Chevis Interactive AI assistant. I answer questions " +
      "about our websites, prices, and care plans from the studio's own " +
      "information, any time of day. For anything I cannot answer, I can " +
      "take your details and the studio will follow up by email within one " +
      "business day. What would you like to know?";
    addMsg(hello, "bot");
    history.push({ role: "assistant", text: hello });
    renderStarters();
  }

  /* ---------- talking to the Worker ---------- */
  function sendUserMessage(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    addMsg(text, "user");
    history.push({ role: "user", text: text });
    input.value = "";
    busy = true;
    sendBtn.disabled = true;
    showTyping();

    function fail() {
      hideTyping();
      addMsg(ERROR_REPLY, "bot");
      history.push({ role: "assistant", text: ERROR_REPLY });
      showLeadForm();
      busy = false;
      sendBtn.disabled = false;
    }

    if (!window.fetch) {
      fail();
      return;
    }
    fetch(WORKER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ messages: history }),
    })
      .then(function (r) {
        return r.json().catch(function () {
          return null;
        });
      })
      .then(function (data) {
        if (!data || typeof data.reply !== "string" || !data.reply.trim()) {
          fail();
          return;
        }
        hideTyping();
        addMsg(data.reply, "bot");
        history.push({ role: "assistant", text: data.reply });
        if (data.showLeadForm) showLeadForm();
        busy = false;
        sendBtn.disabled = false;
      })
      .catch(fail);
  }

  inputRow.addEventListener("submit", function (e) {
    e.preventDefault();
    sendUserMessage(input.value);
  });

  /* ---------- lead capture ---------- */
  function showLeadForm() {
    if (formOpen) return;
    formOpen = true;
    leadSlot.innerHTML = "";

    var form = el("form", "front-desk-form");
    form.setAttribute("novalidate", "");

    var intro = el("p", "front-desk-status");
    intro.innerHTML =
      "<strong>Leave your details.</strong> This goes straight to the studio inbox and the studio replies by email within one business day.";
    form.appendChild(intro);

    function field(labelText, control) {
      var l = el("label", null, labelText);
      l.appendChild(control);
      return l;
    }
    var nameIn = el("input");
    nameIn.type = "text";
    nameIn.name = "name";
    nameIn.required = true;
    nameIn.autocomplete = "name";
    var emailIn = el("input");
    emailIn.type = "email";
    emailIn.name = "email";
    emailIn.required = true;
    emailIn.autocomplete = "email";
    var needIn = el("textarea");
    needIn.name = "need";
    needIn.required = true;
    needIn.placeholder = "A line or two about your business and what you need…";

    form.appendChild(field("Your name", nameIn));
    form.appendChild(field("Your email", emailIn));
    form.appendChild(field("What do you need?", needIn));

    var submit = el("button", "front-desk-send front-desk-formsend", "Send to the studio");
    submit.type = "submit";
    form.appendChild(submit);

    var status = el("p", "front-desk-status");
    form.appendChild(status);

    var cancel = el("button", "front-desk-back", "Not now");
    cancel.type = "button";
    cancel.addEventListener("click", function () {
      leadSlot.innerHTML = "";
      formOpen = false;
    });
    form.appendChild(cancel);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = nameIn.value.trim();
      var email = emailIn.value.trim();
      var need = needIn.value.trim();
      var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!name || !emailOk || !need) {
        status.textContent =
          "Please add your name, a valid email address, and a line about what you need, then the studio can reply properly.";
        return;
      }
      submit.disabled = true;
      submit.textContent = "Sending…";
      status.textContent = "";

      var payload = {
        name: name,
        email: email,
        need: need,
        _subject: "AI assistant inquiry from " + name,
        _template: "table",
        _captcha: "false",
      };

      function mailtoFallback() {
        status.innerHTML =
          "<strong>One more tap:</strong> the form service is not reachable just now, so your email app will open with everything filled in. Just press send there.";
        submit.disabled = false;
        submit.textContent = "Open my email app instead";
        submit.onclick = function () {
          window.location.href =
            "mailto:" +
            STUDIO_EMAIL +
            "?subject=" +
            encodeURIComponent("AI assistant inquiry from " + name) +
            "&body=" +
            encodeURIComponent(
              "Name: " + name + "\nEmail: " + email + "\nWhat I need: " + need
            );
        };
      }

      if (!window.fetch) {
        mailtoFallback();
        return;
      }
      fetch(FORMSUBMIT_AJAX, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (r) {
          return r.json().catch(function () {
            return null;
          });
        })
        .then(function (data) {
          if (data && (data.success === true || data.success === "true")) {
            leadSlot.innerHTML = "";
            formOpen = false;
            addMsg(
              "Thank you, " +
                name.split(" ")[0] +
                ". Your details are with the studio, and they will reply to " +
                email +
                " within one business day.",
              "bot"
            );
          } else {
            mailtoFallback();
          }
        })
        .catch(mailtoFallback);
    });

    leadSlot.appendChild(form);
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
    window.setTimeout(function () {
      input.focus();
    }, 340);
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
