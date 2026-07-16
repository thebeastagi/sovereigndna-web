/* SovereignDNA — membership page logic. No secrets; talks only to same-origin /api. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

  // mobile nav burger (mirrors app.js behaviour)
  var burger = $("burger"), navlinks = $("navlinks");
  if (burger && navlinks) burger.addEventListener("click", function () {
    var open = navlinks.classList.toggle("open");
    burger.setAttribute("aria-expanded", open ? "true" : "false");
  });

  // reveal-on-scroll
  try {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });
  } catch (_) { document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("in"); }); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function selectTier(t) {
    $("memTier").value = t.id;
    var st = $("selectedTier");
    if (t.id === "free") {
      st.innerHTML = "Starting with the <b>Free</b> tier — no payment, instant access.";
      $("memBtn").textContent = "Join free";
    } else {
      st.innerHTML = "Selected: <b>" + esc(t.name) + "</b> — " + esc(t.price_display) +
        (t.cycle === "lifetime" ? " one-time" : t.cycle === "forever" ? "" : " / " + esc(t.cycle));
      $("memBtn").textContent = "Continue to secure checkout →";
    }
    $("joinEyebrow").textContent = t.id === "free" ? "Get started" : "Complete your membership";
    document.getElementById("join").scrollIntoView({ behavior: "smooth", block: "start" });
    var em = $("memEmail"); if (em) setTimeout(function () { em.focus(); }, 350);
  }

  function renderTiers(tiers) {
    var grid = $("tierGrid");
    grid.innerHTML = "";
    tiers.forEach(function (t) {
      var featured = t.id === "sovereign";
      var el = document.createElement("div");
      el.className = "tier reveal in" + (featured ? " featured" : "");
      var cyc = t.cycle === "lifetime" ? "one-time" : t.cycle === "forever" ? "" : "/ " + t.cycle;
      var priceHtml = t.amount_cents === 0
        ? '<div class="price">Free</div>'
        : '<div class="price">' + esc(t.price_display) + ' <small>' + esc(cyc) + "</small></div>";
      var lis = t.features.map(function (f) { return "<li>" + CHECK + "<span>" + esc(f) + "</span></li>"; }).join("");
      el.innerHTML =
        (featured ? '<span class="ribbon">Most popular</span>' : "") +
        "<h3>" + esc(t.name) + "</h3>" +
        '<div class="tier-tag">' + esc(t.tagline) + "</div>" +
        priceHtml +
        "<ul>" + lis + "</ul>" +
        '<button class="btn ' + (featured ? "btn-primary" : "btn-ghost") + '" data-tier="' + esc(t.id) + '">' +
        (t.amount_cents === 0 ? "Start free" : "Choose " + esc(t.name)) + "</button>";
      el.querySelector("button").addEventListener("click", function () { selectTier(t); });
      grid.appendChild(el);
    });
    grid.setAttribute("aria-busy", "false");
  }

  // Load tier catalog from the server (single source of truth for pricing).
  fetch("/api/member/tiers").then(function (r) { return r.json(); }).then(function (j) {
    if (j && j.ok && j.tiers) {
      renderTiers(j.tiers);
      $("pricingNote").textContent = j.pricing_note || "";
      window.__tiers = j.tiers;
    } else { $("tierGrid").innerHTML = '<p class="mem-note">Plans are loading — please refresh.</p>'; }
  }).catch(function () { $("tierGrid").innerHTML = '<p class="mem-note">Could not load plans — please refresh.</p>'; });

  // Checkout submit
  var form = $("memForm");
  if (form) form.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("memEmail").value.trim();
    var tier = $("memTier").value;
    var btn = $("memBtn"), res = $("memResult");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.className = "mem-result err"; res.textContent = "Please enter a valid email."; return; }
    btn.disabled = true; res.className = "mem-result"; res.textContent = "Processing…";
    fetch("/api/member/checkout", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, tier: tier }),
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (out) {
        var j = out.j;
        if (out.ok && j.ok && j.free) {
          res.className = "mem-result ok";
          res.textContent = "You're in! Free membership active. Check your status below to explore benefits.";
          btn.disabled = false;
        } else if (out.ok && j.ok && j.checkout_url) {
          res.className = "mem-result ok";
          res.textContent = "Redirecting to secure AllScale checkout…";
          window.location.href = j.checkout_url;
        } else {
          res.className = "mem-result err";
          res.textContent = (j && j.message) || "Could not start checkout — please retry shortly.";
          btn.disabled = false;
        }
      }).catch(function () { res.className = "mem-result err"; res.textContent = "Network error — please retry."; btn.disabled = false; });
  });

  // Status check + benefit unlock
  var sform = $("statusForm");
  if (sform) sform.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("statusEmail").value.trim();
    var res = $("statusResult"), bene = $("beneBox");
    bene.hidden = true;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.className = "mem-result err"; res.textContent = "Please enter a valid email."; return; }
    res.className = "mem-result"; res.textContent = "Checking…";
    fetch("/api/member/status?email=" + encodeURIComponent(email)).then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok || !j.found) { res.className = "mem-result"; res.textContent = "No membership found for that email. Join above to get started."; return; }
        var label = j.tier.charAt(0).toUpperCase() + j.tier.slice(1);
        if (j.status === "active") {
          res.className = "mem-result ok";
          res.textContent = label + " member · active" + (j.expiry ? " · renews " + j.expiry.slice(0, 10) : "");
          if (j.benefits_unlocked) return unlockBenefit(email);
        } else if (j.status === "pending") {
          res.className = "mem-result"; res.textContent = label + " membership pending — complete your AllScale payment to activate.";
        } else {
          res.className = "mem-result"; res.textContent = label + " membership · " + j.status + ".";
        }
      }).catch(function () { res.className = "mem-result err"; res.textContent = "Network error — please retry."; });
  });

  function unlockBenefit(email) {
    fetch("/api/member/early-access?email=" + encodeURIComponent(email)).then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) return;
        var b = j.early_access.brief;
        var items = b.items.map(function (i) { return "<li>" + esc(i) + "</li>"; }).join("");
        $("beneTitle").textContent = b.title;
        $("beneBody").innerHTML =
          '<p class="mem-note" style="text-align:left;margin:0 0 4px">Updated ' + esc(b.updated) +
          " · priority-waitlist seat confirmed</p><ul>" + items + '</ul><p class="mem-note" style="text-align:left;margin-top:12px">' + esc(b.note) + "</p>";
        $("beneBox").hidden = false;
      }).catch(function () {});
  }
})();
