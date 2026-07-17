/**
 * SovereignDNA — full-stack Cloudflare Worker
 * The Beast × SovereignDNA · flagship grant demo property.
 *
 * Serves the static frontend (via the ASSETS binding) and a real backend API:
 *   GET  /api/status                    → live platform status (phase, PR links, stats)
 *   GET  /api/waitlist/count            → current waitlist size (KV)
 *   POST /api/waitlist                  → join the waitlist (KV-backed, deduped)
 *   GET  /api/ingest/stream             → SSE: live streaming-ingestion demo (synthetic)
 *   GET  /api/privacy-ledger            → sample privacy-ledger entries (synthetic)
 *
 *   -- Membership + payments (2026-07-16) --
 *   GET  /api/member/tiers              → membership tier catalog (server source of truth)
 *   POST /api/member/checkout           → start membership (free = instant; paid = AllScale checkout)
 *   GET  /api/member/status?email=      → membership record for an email
 *   GET  /api/member/early-access       → GATED premium benefit (paid members only)
 *   POST /api/payments/allscale/webhook → HMAC-verified AllScale payment confirmation
 *   GET  /membership, /membership/thanks→ static membership page + post-payment page
 *
 * Secrets: none in source. AllScale credentials, IF present, are read from the
 * Worker env (ALLSCALE_API_KEY / ALLSCALE_API_SECRET / ALLSCALE_BASE_URL).
 * When they are absent, checkout transparently falls back to the dashboard's
 * PUBLIC create-intent endpoint so no secret is ever duplicated into this worker.
 */

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const DASH_CREATE_INTENT_URL = "https://dash.thebeastagi.com/api/payments/allscale/create-intent";

// ── security headers applied to every dynamic response ──────────────────────
function harden(resp) {
  const h = new Headers(resp.headers);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "DENY");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  return new Response(resp.body, { status: resp.status, headers: h });
}

function json(data, status = 200, extra = {}) {
  return harden(new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, "cache-control": "no-store", ...extra },
  }));
}

// ── platform status (single source of truth for the "live" numbers) ─────────
const REPO = "https://github.com/abhilashi/sovereign-dna";
const STATUS = {
  project: "SovereignDNA",
  tagline: "The private genome agent you run locally — collaborating, without your DNA ever leaving your device, to drive the world's Variants of Unknown Significance toward zero.",
  grant: { instrument: "$BEAST", amount_usd: 80000, status: "milestone-gated" },
  // ── Mission / North Star (the product's reason to exist) ──
  mission: {
    northstar: "Every genome carries variants nobody can yet interpret. SovereignDNA is the private agent you run that collaborates — without your DNA ever leaving your device — to drive the world's Variants of Unknown Significance (VUS) toward zero.",
    kpi: "Drive the global count of Variants of Unknown Significance (VUS) toward zero.",
    // Honest, sourced framing of the problem (point-in-time public figures).
    problem: {
      clinvar_classified_variants: "> 2,000,000",
      vus_count_2024_audit: "1,251,444",
      vus_share_pct: 44.6,
      missense_vus_share_pct: 90,
      note: "VUS are the single largest category in ClinVar and are inequitably distributed — people of non-European ancestry receive VUS results at much higher rates because reference databases under-represent their populations.",
      sources: [
        "NAR Genomics & Bioinformatics 2024 (lqae154): 1,251,444 VUS = 44.6% of ClinVar classifications",
        "AJHG 2023 'Will VUS still exist in 2030?': >2M variants, ~36% VUS (+~5% conflicting)",
        "bioRxiv 2026 (MAVE groups): >90% of missense variants in ~4,000 disease genes are VUS",
        "Nature Communications 2025 / Sci Rep 2025: ancestry under-representation drives the VUS gap",
      ],
    },
    lever: "The #1 lever is ancestry-diverse allele frequencies (ACMG BA1/BS1/PM2) — exactly the under-sampled data a globally-distributed private network is positioned to produce.",
    boundary: "Raw DNA never leaves your device — only DP-noised aggregates cross the boundary.",
    honest_role: "SovereignDNA produces prioritized candidate evidence that FEEDS the formal ACMG/ClinGen reclassification pipeline. It does NOT perform or replace clinical interpretation.",
    ladder: "Candidate signal is graded on an L0→L4 evidence ladder (gates, not scores); only L4 items are called a 'proposed reclassification', and even L4 is a submission to expert panels — never a verdict.",
  },
  // ── Capabilities: the on-device analysis-skill catalogue ──
  // Dual role: each skill is a user-facing insight AND a privacy-preserving VUS-reduction sensor.
  capabilities: {
    total_skills: 110,
    family_count: 11,
    note: "110 on-device analysis skills across 11 families. Each runs in the wasmi WASM sandbox (zero network / filesystem egress); the only thing that may cross the boundary — with per-skill consent — is a DP-noised aggregate, never a genotype.",
    families: [
      { key: "A", name: "Traits — visible & self-verifiable", count: 20, value: "Eye color, taste, lactose, alcohol flush — you can confirm the real phenotype, giving the cleanest genotype↔phenotype labels." },
      { key: "B", name: "Ancestry, archaic & population", count: 10, value: "Biogeographic + fine-scale ancestry — the prerequisite for ancestry-stratified allele frequencies, the #1 benign-reclassification lever." },
      { key: "C", name: "Carrier status (recessive)", count: 12, value: "CFTR, HBB, G6PD, HFE and more — actionable, confirmable carrier status with large ancestry frequency gaps." },
      { key: "D", name: "Health-risk & polygenic scores", count: 18, value: "T2D, CAD, breast-cancer and other PRS with honest exposed bands and transferability caveats — never fake percentiles." },
      { key: "E", name: "Pharmacogenomics", count: 12, value: "CYP2C19/2D6, warfarin, statins, HLA drug-reaction — a confirmed drug response is a real-world functional phenotype." },
      { key: "F", name: "Rare-variant & clinical (WGS)", count: 10, value: "Personal VUS report, BRCA/Lynch, novel-variant flagging — the WGS tier where actual rare VUS live and get discovered." },
      { key: "G", name: "Nutrigenomics & metabolism", count: 8, value: "Vitamin D, B12/folate, iron, caffeine — biomarker self-report becomes a quantitative genotype↔phenotype signal." },
      { key: "H", name: "Athletic & physical", count: 5, value: "ACTN3 power/endurance, VO2max, injury lean — self-reported athletic phenotype at scale." },
      { key: "I", name: "Cognitive & behavioral", count: 5, value: "Chronotype, caffeine-sleep and more — heavily caveated (directional/speculative), exposed-bands only." },
      { key: "J", name: "Immune, HLA & infectious-disease", count: 5, value: "HLA typing, CCR5-Δ32, secretor status — very ancestry-variable HLA frequencies plus disease/drug associations." },
      { key: "K", name: "Uniqueness, fingerprint & network-meta", count: 5, value: "Rarity score, genome sonification, kinship matching — grows the network and unlocks family co-segregation (PP1/BS4)." },
    ],
    // Ranked TOP-20 (value × feasibility × VUS-yield). "prototyped" flags shipped skills.
    top: [
      { n: 1,  name: "Ancestry-stratified allele-frequency contribution", value: "Your genotypes add to the frequency map for your ancestry", vus: "★ BA1/BS1/PM2 benign evidence, esp. under-represented populations" },
      { n: 2,  name: "Biogeographic ancestry composition", value: "Your ancestral population mix", vus: "Ancestry-labels every contributed genotype (prereq for frequency stratification)" },
      { n: 3,  name: "Personal VUS report", value: "Which of your variants are VUS in ClinVar today", vus: "Turns users into targeted contributors for their own uncertain variants" },
      { n: 4,  name: "Genetic uniqueness / rarity score", value: "\"Your exact profile is ~1 in X\"", vus: "Surfaces rare candidate variants for matchmaking", prototyped: true },
      { n: 5,  name: "Genome fingerprint + sonification", value: "Your DNA as shareable art + sound", vus: "Engagement/retention → grows the contributor base", prototyped: true },
      { n: 6,  name: "Eye color", value: "Predicted vs your actual eye color", vus: "★ Self-verifiable → clean genotype↔phenotype tuples (PP4/BP4 calibration)" },
      { n: 7,  name: "Lactase persistence", value: "Likely adult lactose tolerance", vus: "Self-verifiable digestion phenotype validating MCM6/LCT in non-European ancestries" },
      { n: 8,  name: "Alcohol flush (ALDH2/ADH1B)", value: "Do you flush when drinking?", vus: "Near-Mendelian gold-standard genotype↔phenotype anchor" },
      { n: 9,  name: "Bitter-taste / cilantro / asparagus", value: "Can you taste PTC? Does cilantro taste soapy?", vus: "Highly self-verifiable near-Mendelian labels across populations" },
      { n: 10, name: "Hereditary hemochromatosis (HFE)", value: "Iron-overload carrier status", vus: "Common actionable variant; ferritin self-report → penetrance signal (PP4)" },
      { n: 11, name: "APOE (Alzheimer's-adjacent)", value: "Your APOE genotype (ε2/ε3/ε4)", vus: "Well-defined locus; family-history → penetrance/age-of-onset by ancestry" },
      { n: 12, name: "Pharmacogenomic formulary (CPIC panel)", value: "Drug-by-drug metabolizer report", vus: "Confirmed drug response = real-world functional phenotype (PP4/PS4-like)", prototyped: true },
      { n: 13, name: "Neanderthal / archaic variant deep-dive", value: "The specific archaic variants you carry", vus: "Introgressed-allele frequencies refine population references", prototyped: true },
      { n: 14, name: "Runs-of-homozygosity / consanguinity", value: "Long identical stretches in your genome", vus: "Enables recessive-VUS prioritization (PM3/segregation context)" },
      { n: 15, name: "G6PD deficiency (X-linked)", value: "Drug / fava-bean hemolysis risk", vus: "Actionable; large ancestry-frequency gaps → high benign-reclassification value" },
      { n: 16, name: "Caffeine metabolism + sleep", value: "Fast/slow caffeine; caffeine-sleep effect", vus: "Self-verifiable behavioral phenotype at massive scale" },
      { n: 17, name: "Vitamin D tendency (GC/CYP2R1)", value: "Genetic lean toward lower vitamin D", vus: "Lab-value self-report → quantitative genotype↔biomarker signal" },
      { n: 18, name: "Type 2 diabetes PRS (honest bands)", value: "Common-variant metabolic lean, bands exposed", vus: "Diagnosis self-report improves non-European PRS transferability (PS4/PP4)" },
      { n: 19, name: "Relative / kinship matching (consented)", value: "Find genetic relatives on the network", vus: "★ Unlocks family co-segregation (PP1/BS4) — population databases can't provide it" },
      { n: 20, name: "Rare-variant carrier matchmaking (Beacon)", value: "\"Someone else carries your rare variant\"", vus: "★ Federated GA4GH-Beacon matching seeds the n-of-2 that starts a case" },
    ],
  },
  phase: {
    // Kept for backward-compatible clients (hero chip, legacy lists).
    current: "Phases 1–4 built · Phase-4 federated network live on synthetic data",
    progress_pct: 82,
    shipped: [
      "Phase 1 — Constant-memory streaming genome ingestion (SSE; flat peak-RAM vs a naïve importer)",
      "Phase 2 — Skills engine + wasmi WASM sandbox with a signed, content-addressed skill registry",
      "Phase 3 — Consent / privacy ledger with revocable consent (Egress::assert_public_only)",
      "Phase 4 — Federated learning: Rényi (ε,δ) differential privacy + Bonawitz secure aggregation",
    ],
    next: [
      "Phase-4 production hardening: Shamir dropout recovery, Byzantine-robust aggregation, coordinator /health+/metrics",
      "Legal gate for real-genome FL: DPIA + independent privacy audit + ε-budget sign-off",
      "Skill authoring SDK + WASM toolkit; expand the on-device analysis-skill catalog",
    ],
  },
  // Full four-phase status — each phase, what it is, and its status.
  phases: [
    {
      n: 1, name: "Universal formats & streaming ingestion", status: "built", label: "BUILT",
      summary: "Stream a whole genome (23andMe / AncestryDNA / VCF) → SQLite at a flat, size-independent peak-RAM. Local-first Tauri workbench.",
      prs: [{ id: 96, title: "Streaming ingestion core", url: `${REPO}/pull/96`, state: "open" }],
    },
    {
      n: 2, name: "Skills engine + WASM sandbox", status: "built", label: "BUILT",
      summary: "Hardcoded analyses become signed skill manifests executed in a wasmi WASM sandbox (empty linker → no net / no fs egress), distributed via a content-addressed skill registry.",
      prs: [{ id: 108, title: "wasmi WASM sandbox", url: `${REPO}/pull/108`, state: "open" }],
    },
    {
      n: 3, name: "Consent & privacy ledger", status: "built", label: "BUILT",
      summary: "User-created agents plus an auditable consent / privacy ledger. Egress::assert_public_only refuses genotypes by construction; consent is revocable and gates every outbound action.",
      prs: [{ id: 112, title: "Consent ledger + signed sharing", url: `${REPO}/pull/112`, state: "open" }],
    },
    {
      n: 4, name: "Federated learning (DP + secure aggregation)", status: "live-synthetic", label: "LIVE · SYNTHETIC",
      summary: "DP-noised, secure-masked model updates aggregate across nodes. Raw DNA never leaves your device — only DP-noised aggregates cross the boundary. Live 3-node round proven on GKE (Jul 17, 2026).",
      caveat: "SYNTHETIC DATA ONLY. Real-genome federated training remains legally gated — it requires a DPIA, an independent privacy audit, and epsilon-budget sign-off before any production launch.",
      prs: [
        { id: 113, title: "Federated DP prototype", url: `${REPO}/pull/113`, state: "open" },
        { id: 114, title: "Rings transport spike", url: `${REPO}/pull/114`, state: "open" },
      ],
    },
  ],
  // Phase-4 live federated-learning network facts.
  federated: {
    status: "live-synthetic",
    proven: "2026-07-17",
    nodes: 3,
    platform: "GKE Autopilot",
    image: "fl-node:0.1.1",
    commit: "72abe32",
    repo: "https://github.com/thebeastagi/sovereigndna-fl-deploy",
    dp: "Rényi (ε,δ) differential-privacy accountant (L2 clip + Gaussian noise)",
    secure_agg: "Bonawitz pairwise additive masking — masks cancel to a DP-noised aggregate; no single view of any device's update",
    boundary: "Raw DNA never leaves your device — only DP-noised aggregates cross the boundary. A clear-gradient update is refused at the device boundary (live refusal probe passed).",
    data: "synthetic only",
    legal_gate: "Real-genome FL is legally gated: DPIA + independent privacy audit + epsilon-budget sign-off required before any production launch.",
  },
  // Payment rails — reuse the LIVE dashboard AllScale checkout. No new endpoint.
  payments: {
    provider: "AllScale",
    checkout_url: "https://dash.thebeastagi.com/pay",
    methods: "card, Apple Pay, Google Pay, and crypto (USDC / USDT settlement)",
    live: true,
    note: "Membership / network access is paid via the live AllScale checkout on the Beast dashboard.",
  },
  pull_requests: [
    { id: 96, title: "Phase 1 · streaming ingestion", url: `${REPO}/pull/96`, state: "open" },
    { id: 108, title: "Phase 2 · wasmi sandbox", url: `${REPO}/pull/108`, state: "open" },
    { id: 112, title: "Phase 3 · consent ledger", url: `${REPO}/pull/112`, state: "open" },
    { id: 113, title: "Phase 4 · federated DP", url: `${REPO}/pull/113`, state: "open" },
    { id: 114, title: "Phase 4 · rings transport", url: `${REPO}/pull/114`, state: "open" },
  ],
  stack: ["Tauri 2.0", "Rust", "React / TypeScript", "SQLite", "Local LLM (Ollama)", "wasmi WASM sandbox", "Rust FL nodes on GKE"],
  privacy: {
    telemetry: "none",
    raw_dna_leaves_device: false,
    outbound: "public rsIDs / reference queries + DP-noised aggregates only, shown in a privacy ledger",
  },
  build: "2026-07-17",
};

// ── membership tiers (SERVER source of truth — amounts are never trusted from client) ──
// Pricing is PLACEHOLDER and adjustable — Robin can revise amount_cents / cycle freely.
const MEMBER_TIERS = Object.freeze({
  free: {
    id: "free",
    name: "Free",
    amount_cents: 0,
    cycle: "forever",
    tagline: "Own your genome, locally.",
    features: [
      "Local-first genome import (23andMe, AncestryDNA, VCF)",
      "Constant-memory streaming ingestion",
      "On-device privacy ledger",
      "Community skills catalog",
      "MIT open-source app",
    ],
  },
  sovereign: {
    id: "sovereign",
    name: "Sovereign",
    amount_cents: 1200, // $12.00 / mo — PLACEHOLDER, adjustable
    cycle: "month",
    tagline: "For power users who want the full agent workbench.",
    features: [
      "Everything in Free",
      "Priority early-access to new analysis skills",
      "Verified research-agent runs (pharmacogenomics, ancestry, traits)",
      "Premium local LLM explain packs",
      "Priority waitlist / private beta seat",
      "Support the sovereign-genomics mission",
    ],
  },
  founder: {
    id: "founder",
    name: "Founder",
    amount_cents: 49900, // $499.00 one-time (lifetime) — PLACEHOLDER, adjustable
    cycle: "lifetime",
    tagline: "Back the mission. Lifetime sovereign access.",
    features: [
      "Everything in Sovereign — for life",
      "Founding-member badge + name in credits (opt-in)",
      "Direct roadmap input channel",
      "Earliest access to every new format & agent",
      "Lifetime — pay once, no renewals",
    ],
  },
});

const PAID_TIERS = new Set(["sovereign", "founder"]);
const CYCLE_DAYS = { month: 30, year: 365, lifetime: 0, forever: 0 };

function isEmail(s) {
  return typeof s === "string" && /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(s.trim());
}

function tierCatalog() {
  return Object.values(MEMBER_TIERS).map((t) => ({
    id: t.id, name: t.name, amount_cents: t.amount_cents, cycle: t.cycle,
    price_display: t.amount_cents === 0 ? "Free" : `$${(t.amount_cents / 100).toFixed(t.amount_cents % 100 ? 2 : 0)}`,
    tagline: t.tagline, features: t.features, paid: PAID_TIERS.has(t.id),
  }));
}

// ── waitlist ────────────────────────────────────────────────────────────────
async function handleWaitlist(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  const email = (body && body.email || "").toString().trim().toLowerCase();
  const role = (body && body.role || "").toString().slice(0, 40);
  if (!isEmail(email)) return json({ ok: false, error: "invalid_email" }, 422);
  if (!env.SOVDNA_KV) return json({ ok: false, error: "storage_unavailable" }, 503);

  const key = "wl:" + email;
  const existing = await env.SOVDNA_KV.get(key);
  let count = parseInt((await env.SOVDNA_KV.get("wl:count")) || "0", 10) || 0;
  if (!existing) {
    count += 1;
    await env.SOVDNA_KV.put(key, JSON.stringify({
      email, role, ts: new Date().toISOString(), position: count,
    }));
    await env.SOVDNA_KV.put("wl:count", String(count));
    return json({ ok: true, position: count, deduped: false, count });
  }
  const rec = JSON.parse(existing);
  return json({ ok: true, position: rec.position, deduped: true, count });
}

// ── in-memory rate limiter (per-isolate; best-effort abuse brake) ────────────
const rlBuckets = new Map();
function rateLimited(key, limit, windowMs) {
  const now = Date.now();
  const bucket = (rlBuckets.get(key) || []).filter((t) => now - t < windowMs);
  if (bucket.length >= limit) { rlBuckets.set(key, bucket); return true; }
  bucket.push(now);
  rlBuckets.set(key, bucket);
  return false;
}

// ── AllScale HMAC helpers (mirror the proven dashboard pattern) ──────────────
function base64FromBytes(buffer) {
  let binary = "";
  for (const b of new Uint8Array(buffer)) binary += String.fromCharCode(b);
  return btoa(binary);
}
async function sha256Hex(data) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hmacBase64(secret, message) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return base64FromBytes(sig);
}
async function signAllScaleRequest(env, method, path, query, body) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();
  const bodyHash = await sha256Hex(body || "");
  const canonical = [method.toUpperCase(), path, query || "", timestamp, nonce, bodyHash].join("\n");
  const signature = await hmacBase64(env.ALLSCALE_API_SECRET, canonical);
  return { "X-API-Key": env.ALLSCALE_API_KEY, "X-Timestamp": timestamp, "X-Nonce": nonce, "X-Signature": `v1=${signature}` };
}
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// Mint a checkout intent. Self-signs when this worker holds AllScale creds;
// otherwise reuses the dashboard's PUBLIC create-intent endpoint (no secret
// duplication). Returns { checkout_url, checkout_intent_id, order_id } or null.
async function mintCheckoutIntent(env, { amountCents, description, reference, orderId, stableCoin }) {
  const selfSigned = Boolean(env.ALLSCALE_API_KEY && env.ALLSCALE_API_SECRET);
  if (selfSigned) {
    const base = env.ALLSCALE_BASE_URL || "https://openapi.allscale.io";
    const safe = {
      stable_coin: stableCoin === 2 ? 2 : 2, // default USDC (unlocks card/Apple/Google Pay)
      amount_cents: amountCents,
      order_id: orderId,
      order_description: description,
      redirect_url: "https://sovereigndna.thebeastagi.com/membership/thanks",
      extra: { source: "sovereigndna-membership", reference, created_by: "sovereigndna-web" },
    };
    const bodyStr = JSON.stringify(safe);
    const headers = await signAllScaleRequest(env, "POST", "/v1/checkout_intents/", "", bodyStr);
    let res, text;
    try {
      res = await fetch(`${base}/v1/checkout_intents/`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: bodyStr });
      text = await res.text();
    } catch { return { error: "upstream_unreachable" }; }
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = null; }
    const payload = parsed && parsed.payload && typeof parsed.payload === "object" ? parsed.payload : {};
    const url = typeof payload.checkout_url === "string" ? payload.checkout_url : null;
    if (!res.ok || !parsed || parsed.code !== 0 || !url) return { error: "create_failed", upstream_status: res.status };
    return { checkout_url: url, checkout_intent_id: payload.allscale_checkout_intent_id || null, order_id: orderId, mode: "self-signed" };
  }
  // Fallback: dashboard public create-intent (mints a real, NON-charging URL).
  // Prefer the service binding (same-zone public fetch is blocked as a loopback);
  // fall back to a plain fetch only for local dev where the binding is absent.
  const req = new Request(DASH_CREATE_INTENT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      amount_cents: amountCents,
      stable_coin: 2, // USDC → unlocks card / Apple Pay / Google Pay on hosted page
      order_description: description,
      reference,
    }),
  });
  let res, jr;
  try {
    if (env.DASH && typeof env.DASH.fetch === "function") {
      res = await env.DASH.fetch(req.clone());
    } else {
      res = await fetch(req);
    }
    jr = await res.json();
  } catch {
    // Last-ditch: if the binding threw, try a direct public fetch (local dev).
    try { res = await fetch(req); jr = await res.json(); }
    catch { return { error: "upstream_unreachable" }; }
  }
  if (!res.ok || !jr || jr.status !== "ok" || !jr.checkout_url) {
    return { error: jr && jr.status ? jr.status : "create_failed", upstream_status: res.status };
  }
  return { checkout_url: jr.checkout_url, checkout_intent_id: jr.checkout_intent_id || null, order_id: jr.order_id || orderId, mode: "dash-backend" };
}

function memKey(email) { return "mem:" + email; }
function memIntentKey(intentId) { return "mem:intent:" + intentId; }

async function readMembership(env, email) {
  if (!env.SOVDNA_KV) return null;
  const raw = await env.SOVDNA_KV.get(memKey(email));
  return raw ? JSON.parse(raw) : null;
}

function computeExpiry(cycle, fromISO) {
  const days = CYCLE_DAYS[cycle] || 0;
  if (!days) return null; // lifetime / forever / free → no expiry
  const base = fromISO ? new Date(fromISO) : new Date();
  return new Date(base.getTime() + days * 86400_000).toISOString();
}

// ── POST /api/member/checkout ────────────────────────────────────────────────
async function handleMemberCheckout(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (rateLimited(`mem-checkout:${ip}`, 20, 60_000)) return json({ ok: false, error: "rate_limited" }, 429);
  if (rateLimited("mem-checkout:global", 400, 60_000)) return json({ ok: false, error: "rate_limited" }, 429);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  const email = (body && body.email || "").toString().trim().toLowerCase();
  const tierId = (body && body.tier || "").toString().trim().toLowerCase();
  if (!isEmail(email)) return json({ ok: false, error: "invalid_email" }, 422);
  const tier = MEMBER_TIERS[tierId];
  if (!tier) return json({ ok: false, error: "invalid_tier" }, 400);
  if (!env.SOVDNA_KV) return json({ ok: false, error: "storage_unavailable" }, 503);

  const now = new Date().toISOString();
  const existing = await readMembership(env, email);

  // ── Free tier: activate immediately, no payment ──
  if (tier.amount_cents === 0) {
    if (existing && existing.status === "active" && PAID_TIERS.has(existing.tier)) {
      // Don't downgrade an active paid member to free silently.
      return json({ ok: true, tier: existing.tier, status: existing.status, downgrade_ignored: true });
    }
    let count = parseInt((await env.SOVDNA_KV.get("mem:count")) || "0", 10) || 0;
    if (!existing) count += 1;
    const rec = {
      email, tier: "free", status: "active", cycle: "forever",
      amount_cents: 0, created_at: existing ? existing.created_at : now, updated_at: now,
      expiry: null, intent_id: null, order_id: null, position: existing ? existing.position : count,
    };
    await env.SOVDNA_KV.put(memKey(email), JSON.stringify(rec));
    if (!existing) await env.SOVDNA_KV.put("mem:count", String(count));
    return json({ ok: true, tier: "free", status: "active", free: true, position: rec.position });
  }

  // ── Paid tier: mint an AllScale hosted-checkout intent ──
  const orderId = `sovdna-mem-${tierId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const description = `SovereignDNA ${tier.name} membership (${tier.cycle === "lifetime" ? "lifetime" : "per " + tier.cycle})`;
  const reference = `sovdna:${tierId}:${email}`;
  const minted = await mintCheckoutIntent(env, {
    amountCents: tier.amount_cents, description, reference, orderId, stableCoin: 2,
  });
  if (!minted || minted.error) {
    const status = minted && minted.error === "unavailable" ? 503 : 502;
    return json({ ok: false, error: "checkout_unavailable", detail: minted ? minted.error : "unknown", message: "Payments are being configured — please try again shortly or join the waitlist." }, status);
  }

  // Persist a PENDING membership + reverse index for webhook correlation.
  const intentId = minted.checkout_intent_id || null;
  const rec = {
    email, tier: tierId, status: "pending", cycle: tier.cycle, amount_cents: tier.amount_cents,
    created_at: existing ? existing.created_at : now, updated_at: now,
    expiry: existing ? existing.expiry : null,
    intent_id: intentId, order_id: minted.order_id || orderId,
    prior_tier: existing ? existing.tier : null, prior_status: existing ? existing.status : null,
    mode: minted.mode,
  };
  await env.SOVDNA_KV.put(memKey(email), JSON.stringify(rec));
  if (intentId) await env.SOVDNA_KV.put(memIntentKey(intentId), email, { expirationTtl: 60 * 60 * 24 * 7 });
  // Also index by order_id for webhooks that only echo order_id.
  await env.SOVDNA_KV.put(memIntentKey(minted.order_id || orderId), email, { expirationTtl: 60 * 60 * 24 * 7 });

  return json({
    ok: true, tier: tierId, status: "pending",
    checkout_url: minted.checkout_url, checkout_intent_id: intentId, order_id: minted.order_id || orderId,
    amount_cents: tier.amount_cents,
  });
}

// ── GET /api/member/status?email= ────────────────────────────────────────────
async function handleMemberStatus(url, env) {
  const email = (url.searchParams.get("email") || "").toString().trim().toLowerCase();
  if (!isEmail(email)) return json({ ok: false, error: "invalid_email" }, 422);
  const rec = await readMembership(env, email);
  if (!rec) return json({ ok: true, found: false, tier: null, status: "none" });
  // Lazily expire.
  let status = rec.status;
  if (status === "active" && rec.expiry && new Date(rec.expiry) < new Date()) status = "expired";
  return json({
    ok: true, found: true, email: rec.email, tier: rec.tier, status,
    cycle: rec.cycle, expiry: rec.expiry, since: rec.created_at,
    paid: PAID_TIERS.has(rec.tier), benefits_unlocked: status === "active" && PAID_TIERS.has(rec.tier),
  });
}

// ── GET /api/member/early-access (GATED benefit) ─────────────────────────────
// Premium members-only research brief + priority-waitlist confirmation.
async function handleEarlyAccess(url, env) {
  const email = (url.searchParams.get("email") || "").toString().trim().toLowerCase();
  if (!isEmail(email)) return json({ ok: false, error: "invalid_email" }, 422);
  const rec = await readMembership(env, email);
  const active = rec && rec.status === "active" && (!rec.expiry || new Date(rec.expiry) >= new Date());
  if (!rec || !active || !PAID_TIERS.has(rec.tier)) {
    return json({ ok: false, error: "membership_required", message: "Early access is a Sovereign / Founder benefit. Upgrade your membership to unlock." }, 403);
  }
  return json({
    ok: true, tier: rec.tier,
    early_access: {
      priority_waitlist: true,
      seat: rec.position || "confirmed",
      brief: {
        title: "SovereignDNA — Member Early-Access Brief",
        updated: STATUS.build,
        items: [
          "Phase 1.2 preview: transparent BGZF/gzip/zstd + tabix region queries — try the pre-release parser.",
          "New research-agent: pharmacogenomics skill (CYP2D6/CYP2C19) running fully on-device.",
          "GRCh37⇄GRCh38 liftover harmonization design doc — member feedback channel open.",
        ],
        note: "Members-only. Synthetic/reference data — not medical advice.",
      },
    },
  });
}

// ── POST /api/payments/allscale/webhook (HMAC-verified confirmation) ─────────
async function handleAllScaleWebhook(url, request, env) {
  if (!env.ALLSCALE_API_SECRET) return json({ status: "missing_webhook_secret" }, 503);
  const webhookId = request.headers.get("X-Webhook-Id") || "";
  const timestamp = request.headers.get("X-Webhook-Timestamp") || "";
  const nonce = request.headers.get("X-Webhook-Nonce") || "";
  const sigHeader = request.headers.get("X-Webhook-Signature") || "";
  const sig = sigHeader.startsWith("v1=") ? sigHeader.slice(3) : sigHeader;
  if (!webhookId || !timestamp || !nonce || !sig) return json({ status: "missing_signature_headers" }, 401);
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return json({ status: "stale_webhook" }, 401);
  const raw = new Uint8Array(await request.arrayBuffer());
  const bodyHash = await sha256Hex(raw);
  const canonical = ["allscale:webhook:v1", "POST", url.pathname, url.search ? url.search.slice(1) : "", webhookId, timestamp, nonce, bodyHash].join("\n");
  const expected = await hmacBase64(env.ALLSCALE_API_SECRET, canonical);
  if (!timingSafeEqual(sig, expected)) return json({ status: "invalid_signature" }, 401);

  // Idempotency / replay guard.
  const idemKey = `mem:webhook:${webhookId}:${nonce}`;
  if (env.SOVDNA_KV) {
    if (await env.SOVDNA_KV.get(idemKey)) return json({ status: "duplicate_webhook", webhook_id: webhookId }, 409);
  }
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(raw)); } catch { return json({ status: "bad_json" }, 400); }

  const intentId = payload.all_scale_checkout_intent_id || payload.checkout_intent_id || null;
  const orderId = payload.order_id || null;
  const eventStatus = String(payload.status || payload.event_type || payload.type || "").toLowerCase();
  const paid = /paid|success|complete|confirmed|settled/.test(eventStatus);

  let updated = null;
  if (env.SOVDNA_KV) {
    await env.SOVDNA_KV.put(idemKey, "1", { expirationTtl: 60 * 60 * 24 * 30 });
    // Correlate to a pending membership by intent_id, then order_id.
    let email = null;
    if (intentId) email = await env.SOVDNA_KV.get(memIntentKey(intentId));
    if (!email && orderId) email = await env.SOVDNA_KV.get(memIntentKey(orderId));
    if (email && paid) {
      const rec = await readMembership(env, email);
      if (rec) {
        const now = new Date().toISOString();
        rec.status = "active";
        rec.updated_at = now;
        rec.activated_at = now;
        rec.expiry = computeExpiry(rec.cycle, now);
        rec.intent_id = intentId || rec.intent_id;
        rec.tx_hash = payload.tx_hash || null;
        await env.SOVDNA_KV.put(memKey(email), JSON.stringify(rec));
        updated = { tier: rec.tier, status: rec.status, expiry: rec.expiry };
      }
    }
    // Persist a redacted receipt for audit.
    await env.SOVDNA_KV.put(`mem:receipt:${webhookId}`, JSON.stringify({
      received_at: new Date().toISOString(), webhook_id: webhookId, checkout_intent_id: intentId,
      order_id: orderId, status: eventStatus, tx_hash: payload.tx_hash || null, membership_updated: Boolean(updated),
    }), { expirationTtl: 60 * 60 * 24 * 180 });
  }
  return json({ status: "accepted", webhook_id: webhookId, checkout_intent_id: intentId, order_id: orderId, membership_updated: updated });
}

// ── SSE: streaming-ingestion demo ───────────────────────────────────────────
function handleIngestStream(url) {
  const totalVariants = Math.min(Math.max(parseInt(url.searchParams.get("variants") || "650000", 10) || 650000, 1000), 3_000_000);
  const format = ["23andMe", "AncestryDNA", "VCF"].includes(url.searchParams.get("format")) ? url.searchParams.get("format") : "23andMe";
  const batchSize = 50000;              // matches DbBatchSink
  const bufferKiB = 256;                // matches BufReader
  const bytesPerVariant = 42;           // ~synthetic 23andMe line width
  const totalBytes = totalVariants * bytesPerVariant;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      send("meta", { format, totalVariants, totalBytes, batchSize, bufferKiB, refBuild: "GRCh37" });

      let processed = 0, bytes = 0, batches = 0;
      const chromosomes = ["1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18","19","20","21","22","X","Y","MT"];
      const ticks = 40;
      const perTick = Math.ceil(totalVariants / ticks);
      for (let t = 0; t < ticks; t++) {
        const inc = Math.min(perTick, totalVariants - processed);
        processed += inc; bytes += inc * bytesPerVariant;
        const newBatches = Math.floor(processed / batchSize);
        const flushed = newBatches > batches;
        batches = newBatches;
        send("progress", {
          processed,
          bytes,
          pct: Math.round((processed / totalVariants) * 1000) / 10,
          batches,
          flushed,
          workingSetKiB: bufferKiB + Math.round((batchSize * bytesPerVariant) / 1024),
          chr: chromosomes[Math.floor((t / ticks) * chromosomes.length)],
          rate: Math.round(perTick / 0.045),
        });
        await new Promise((r) => setTimeout(r, 45));
      }
      send("done", {
        processed, bytes, batches,
        peakWorkingSetKiB: bufferKiB + Math.round((batchSize * bytesPerVariant) / 1024),
        note: "Peak memory is bounded by buffer + one batch — independent of genome size.",
      });
      controller.close();
    },
  });
  return harden(new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "connection": "keep-alive",
    },
  }));
}

// ── sample privacy ledger (synthetic, illustrative) ─────────────────────────
const PRIVACY_LEDGER = [
  { ts: "2026-07-17T10:12:33Z", action: "Federated round (opt-in)", left_device: "DP-noised, secure-masked aggregate share — no genotypes, no clear gradients", raw_dna: false, dest: "FL coordinator (aggregate only)", reason: "Contribute a differentially-private model update" },
  { ts: "2026-07-16T09:04:11Z", action: "PubMed scan", left_device: "rsID list (128 public rsIDs)", raw_dna: false, dest: "pubmed.ncbi.nlm.nih.gov", reason: "Watch literature for your variants" },
  { ts: "2026-07-16T09:04:02Z", action: "ClinVar refresh", left_device: "reference query (no genotypes)", raw_dna: false, dest: "ncbi.nlm.nih.gov/clinvar", reason: "Update pathogenicity annotations" },
  { ts: "2026-07-16T08:59:47Z", action: "Local skill run: Pharmacogenomics", left_device: "nothing", raw_dna: false, dest: "on-device", reason: "Sandboxed local analysis" },
  { ts: "2026-07-16T08:58:20Z", action: "LLM explain (opt-in)", left_device: "curated summary (approved), no raw DNA", raw_dna: false, dest: "user-provided model key", reason: "Plain-language explanation" },
  { ts: "2026-07-16T08:55:03Z", action: "Genome import", left_device: "nothing", raw_dna: false, dest: "on-device (SQLite)", reason: "Streaming ingestion, constant memory" },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname.startsWith("/api/")) {
      if (pathname === "/api/status" && request.method === "GET") {
        return json({ ...STATUS, now: new Date().toISOString() });
      }
      if (pathname === "/api/waitlist/count" && request.method === "GET") {
        const c = env.SOVDNA_KV ? parseInt((await env.SOVDNA_KV.get("wl:count")) || "0", 10) : 0;
        return json({ ok: true, count: c || 0 });
      }
      if (pathname === "/api/waitlist" && request.method === "POST") {
        return handleWaitlist(request, env);
      }
      if (pathname === "/api/ingest/stream" && request.method === "GET") {
        return handleIngestStream(url);
      }
      if (pathname === "/api/privacy-ledger" && request.method === "GET") {
        return json({ ok: true, entries: PRIVACY_LEDGER });
      }
      // ── membership + payments ──
      if (pathname === "/api/member/tiers" && request.method === "GET") {
        return json({ ok: true, tiers: tierCatalog(), pricing_note: "Placeholder pricing — adjustable before public launch." });
      }
      if (pathname === "/api/member/checkout" && request.method === "POST") {
        return handleMemberCheckout(request, env);
      }
      if (pathname === "/api/member/status" && request.method === "GET") {
        return handleMemberStatus(url, env);
      }
      if (pathname === "/api/member/early-access" && request.method === "GET") {
        return handleEarlyAccess(url, env);
      }
      if (pathname === "/api/payments/allscale/webhook" && request.method === "POST") {
        return handleAllScaleWebhook(url, request, env);
      }
      return json({ ok: false, error: "not_found" }, 404);
    }

    // Non-API: serve static assets (index.html, css, js, svg…).
    // Clean URLs /membership and /membership/thanks are served directly by the
    // ASSETS binding (public/membership.html and public/membership/thanks.html).
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};
