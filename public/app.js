/* SovereignDNA — frontend logic. No deps, no trackers. */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fmtN = (n) => n.toLocaleString("en-US");
  const fmtBytes = (b) => {
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
    if (b < 1073741824) return (b / 1048576).toFixed(1) + " MB";
    return (b / 1073741824).toFixed(2) + " GB";
  };

  /* ── mobile nav ──────────────────────────────────────────────────── */
  const burger = $("#burger"), links = $("#navlinks");
  if (burger) burger.addEventListener("click", () => {
    const open = links.classList.toggle("open");
    burger.setAttribute("aria-expanded", open ? "true" : "false");
  });
  $$("#navlinks a").forEach((a) => a.addEventListener("click", () => {
    links.classList.remove("open"); burger && burger.setAttribute("aria-expanded", "false");
  }));

  /* ── reveal on scroll ────────────────────────────────────────────── */
  if ("IntersectionObserver" in window && !reduce) {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }), { threshold: 0.12 });
    $$(".reveal").forEach((el) => io.observe(el));
  } else {
    $$(".reveal").forEach((el) => el.classList.add("in"));
  }

  /* ── DNA helix canvas ────────────────────────────────────────────── */
  (function helix() {
    const cv = $("#helix"); if (!cv) return;
    const ctx = cv.getContext("2d");
    let W, H, dpr;
    function size() {
      dpr = Math.min(devicePixelRatio || 1, 2);
      const r = cv.getBoundingClientRect();
      W = cv.width = r.width * dpr; H = cv.height = r.height * dpr;
    }
    size(); addEventListener("resize", size);
    const cols = ["#33e3c6", "#6d7cff", "#b16cff"];
    function lerpColor(t) {
      const seg = t < .5 ? [cols[0], cols[1], t * 2] : [cols[1], cols[2], (t - .5) * 2];
      const a = seg[0].match(/\w\w/g).map((x) => parseInt(x, 16));
      const b = seg[1].match(/\w\w/g).map((x) => parseInt(x, 16));
      const k = seg[2];
      return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(",")})`;
    }
    let phase = 0;
    function frame() {
      ctx.clearRect(0, 0, W, H);
      const cx = W * 0.52, amp = W * 0.16, turns = 2.4, pts = 46;
      const top = H * 0.06, bot = H * 0.94, span = bot - top;
      const p1 = [], p2 = [];
      for (let i = 0; i <= pts; i++) {
        const f = i / pts;
        const y = top + f * span;
        const ang = f * Math.PI * 2 * turns + phase;
        const x1 = cx + Math.sin(ang) * amp;
        const x2 = cx + Math.sin(ang + Math.PI) * amp;
        const z1 = Math.cos(ang);           // depth for scale/alpha
        const z2 = Math.cos(ang + Math.PI);
        p1.push([x1, y, z1]); p2.push([x2, y, z2]);
      }
      // rungs
      for (let i = 0; i <= pts; i += 2) {
        const a = p1[i], b = p2[i], f = i / pts;
        ctx.strokeStyle = lerpColor(f);
        ctx.globalAlpha = 0.18 + 0.22 * ((a[2] + b[2]) / 2 + 1) / 2;
        ctx.lineWidth = 1.2 * dpr;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      // strands (nodes)
      [p1, p2].forEach((strand, si) => {
        for (let i = 0; i < strand.length; i++) {
          const [x, y, z] = strand[i];
          const f = i / pts;
          const s = (z + 1.3) / 2;
          ctx.globalAlpha = 0.35 + 0.6 * s;
          ctx.fillStyle = lerpColor(f);
          ctx.shadowColor = lerpColor(f); ctx.shadowBlur = 10 * dpr * s;
          ctx.beginPath(); ctx.arc(x, y, (1.6 + 2.6 * s) * dpr, 0, 7); ctx.fill();
        }
      });
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      if (!reduce) { phase += 0.012; requestAnimationFrame(frame); }
    }
    frame();
  })();

  /* ── status API → hero chip, phase lists, PRs ────────────────────── */
  fetch("/api/status").then((r) => r.json()).then((s) => {
    const chip = $("#statusText");
    if (chip) chip.textContent = `${s.phase.progress_pct}% · ${s.phase.current.split("—")[0].trim()}`;

    const shipped = $("#shippedList");
    if (shipped && s.phase.shipped) shipped.innerHTML = s.phase.shipped.map((x) =>
      `<li class="done"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>${esc(x)}</li>`).join("");

    const next = $("#nextList");
    if (next && s.phase.next) next.innerHTML = s.phase.next.map((x) =>
      `<li class="next"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>${esc(x)}</li>`).join("");

    const pr = $("#prRow");
    if (pr && s.pull_requests) pr.innerHTML = s.pull_requests.map((p) =>
      `<a class="pr-chip" href="${esc(p.url)}" target="_blank" rel="noopener">PR #${p.id} · ${esc(p.title)} <span class="st">● ${esc(p.state)}</span></a>`).join("");
  }).catch(() => { const c = $("#statusText"); if (c) c.textContent = "status offline"; });

  function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

  /* ── privacy ledger ──────────────────────────────────────────────── */
  fetch("/api/privacy-ledger").then((r) => r.json()).then((d) => {
    const body = $("#ledgerBody"); if (!body || !d.entries) return;
    body.innerHTML = d.entries.map((e) => `<tr>
      <td class="ts">${esc(e.ts.replace("T", " ").replace("Z", " UTC"))}</td>
      <td class="act">${esc(e.action)}</td>
      <td>${esc(e.left_device)}</td>
      <td><span class="badge-no"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>never</span></td>
      <td class="mono" style="font-size:12px">${esc(e.dest)}</td>
    </tr>`).join("");
  }).catch(() => {});

  /* ── waitlist count ──────────────────────────────────────────────── */
  function refreshCount() {
    fetch("/api/waitlist/count").then((r) => r.json()).then((d) => {
      const c = $("#wlCount");
      if (c && typeof d.count === "number") c.textContent = d.count > 0 ? `${fmtN(d.count)} already on the list` : "Be the first on the list";
    }).catch(() => {});
  }
  refreshCount();

  const wlForm = $("#wlForm");
  if (wlForm) wlForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = $("#wlEmail").value.trim();
    const role = $("#wlRole").value;
    const res = $("#wlResult"), btn = $("#wlBtn");
    res.className = "wl-result";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.classList.add("err"); res.textContent = "Please enter a valid email."; return; }
    btn.disabled = true; btn.textContent = "…";
    fetch("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, role }) })
      .then((r) => r.json()).then((d) => {
        if (d.ok) {
          res.classList.add("ok");
          res.textContent = d.deduped ? `You're already in — position #${fmtN(d.position)}. We'll be in touch.` : `You're in! Position #${fmtN(d.position)}. Welcome to the sovereign genome.`;
          wlForm.reset(); refreshCount();
        } else {
          res.classList.add("err");
          res.textContent = d.error === "invalid_email" ? "That email doesn't look right." : "Something went wrong — please try again.";
        }
      }).catch(() => { res.classList.add("err"); res.textContent = "Network error — please try again."; })
      .finally(() => { btn.disabled = false; btn.textContent = "Request access"; });
  });

  /* ── streaming ingestion demo (SSE) ──────────────────────────────── */
  const sizeRange = $("#sizeRange"), sizeVal = $("#sizeVal");
  if (sizeRange) sizeRange.addEventListener("input", () => {
    sizeVal.textContent = fmtN(+sizeRange.value) + " variants";
  });

  let curFmt = "23andMe";
  $$("#fmtSeg button").forEach((b) => b.addEventListener("click", () => {
    $$("#fmtSeg button").forEach((x) => x.setAttribute("aria-pressed", "false"));
    b.setAttribute("aria-pressed", "true"); curFmt = b.dataset.fmt;
  }));

  const runBtn = $("#runBtn");
  let es = null;
  if (runBtn) runBtn.addEventListener("click", () => {
    if (es) { es.close(); es = null; }
    const variants = +sizeRange.value;
    const bytesPerVariant = 42;
    const fileBytes = variants * bytesPerVariant;
    // naïve read_to_string holds the whole file + parsed vector in RAM.
    const naiveMB = (fileBytes + variants * 56) / 1048576;

    runBtn.disabled = true; runBtn.textContent = "Streaming…";
    setStat("#stVariants", "0"); setStat("#stBytes", "0 B"); setStat("#stBatches", "0"); setStat("#stMem", "— MB");
    $("#progFill").style.width = "0%"; $("#pctNow").textContent = "0.0%";
    $("#demoNote").innerHTML = "<strong>Streaming…</strong> reading the file in 256 KiB chunks; each variant is written to SQLite and dropped from memory.";

    es = new EventSource(`/api/ingest/stream?variants=${variants}&format=${encodeURIComponent(curFmt)}`);
    let streamMB = 2.3;

    es.addEventListener("meta", (ev) => {
      const m = JSON.parse(ev.data);
      streamMB = (m.bufferKiB + (m.batchSize * bytesPerVariant) / 1024) / 1024;
    });
    es.addEventListener("progress", (ev) => {
      const p = JSON.parse(ev.data);
      setStat("#stVariants", fmtN(p.processed));
      setStat("#stBytes", fmtBytes(p.bytes));
      setStat("#stBatches", fmtN(p.batches));
      setStat("#stMem", streamMB.toFixed(1) + " MB");
      $("#progFill").style.width = p.pct + "%";
      $("#pctNow").textContent = p.pct.toFixed(1) + "%";
      $("#chrNow").textContent = "chr" + p.chr;
      $("#rateNow").textContent = fmtN(p.rate) + " variants/s";
      // memory bars: naïve grows with the file; streaming stays flat.
      const maxMB = Math.max(naiveMB, streamMB, 1);
      $("#memNaive").style.width = Math.min(100, (naiveMB * (p.pct / 100) / maxMB) * 100).toFixed(1) + "%";
      $("#memNaiveV").textContent = (naiveMB * (p.pct / 100)).toFixed(0) + " MB";
      $("#memStream").style.width = ((streamMB / maxMB) * 100).toFixed(1) + "%";
      $("#memStreamV").textContent = streamMB.toFixed(1) + " MB";
    });
    es.addEventListener("done", (ev) => {
      const d = JSON.parse(ev.data);
      es.close(); es = null;
      runBtn.disabled = false; runBtn.textContent = "▶ Run again";
      $("#memNaive").style.width = "100%"; $("#memNaiveV").textContent = naiveMB.toFixed(0) + " MB";
      const saved = (naiveMB / streamMB).toFixed(0);
      $("#demoNote").innerHTML = `<strong>Done.</strong> Ingested ${fmtN(d.processed)} variants (${fmtBytes(d.bytes)}) at a flat <strong>${streamMB.toFixed(1)} MB</strong> working set. A naïve <span class="mono">read_to_string</span> importer would have peaked near <strong>${naiveMB.toFixed(0)} MB</strong> — about <strong>${saved}× more</strong>. That gap is why whole-genome files run on a laptop.`;
    });
    es.onerror = () => {
      if (es) { es.close(); es = null; }
      runBtn.disabled = false; runBtn.textContent = "▶ Run ingestion";
      $("#demoNote").innerHTML = "<strong>Stream interrupted.</strong> Please run again.";
    };
  });

  function setStat(sel, v) { const el = $(sel); if (el) el.textContent = v; }
})();
