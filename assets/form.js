/* Start Your Project form — same lead-capture pattern as the live site:
   FormSubmit AJAX endpoint for the studio inbox. Falls back to a plain
   form POST (the form's action attribute) if fetch is unavailable. */
(function () {
  var form = document.getElementById("project-form");
  if (!form) return;
  var ok = document.getElementById("form-ok");
  var err = document.getElementById("form-err");
  form.addEventListener("submit", function (e) {
    if (!window.fetch) return; // let the plain POST happen
    e.preventDefault();
    var btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "Sending…";
    var data = {};
    new FormData(form).forEach(function (v, k) { data[k] = v; });
    data._subject = "New project inquiry — " + (data.business || data.name || "website");
    data._template = "table";
    fetch("https://formsubmit.co/ajax/chevisinteractive@gmail.com", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(data)
    }).then(function (r) {
      if (!r.ok) throw new Error("send failed");
      form.style.display = "none";
      if (ok) { ok.style.display = "block"; ok.focus(); }
    }).catch(function () {
      btn.disabled = false;
      btn.textContent = "Send Project Inquiry";
      if (err) err.style.display = "block";
    });
  });
})();
