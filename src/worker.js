/**
 * SovereignDNA — full-stack Cloudflare Worker
 * The Beast × SovereignDNA · flagship grant demo property.
 *
 * Serves the static frontend (via the ASSETS binding) and a real backend API:
 *   GET  /api/status            → live platform status (phase, PR links, stats)
 *   GET  /api/waitlist/count    → current waitlist size (KV)
 *   POST /api/waitlist          → join the waitlist (KV-backed, deduped)
 *   GET  /api/ingest/stream     → SSE: live streaming-ingestion demo (synthetic)
 *   GET  /api/privacy-ledger    → sample privacy-ledger entries (synthetic)
 *
 * No secrets in source. Synthetic/sample data only. Same-origin design.
 */

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

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
const STATUS = {
  project: "SovereignDNA",
  tagline: "Your genome, your device. A local-first DNA agent workbench.",
  grant: { instrument: "$BEAST", amount_usd: 80000, status: "milestone-gated" },
  phase: {
    current: "Phase 1 — Universal formats & streaming ingestion",
    progress_pct: 22,
    shipped: [
      "Constant-memory streaming genome ingestion (file → parser → SQLite)",
      "GenomeParser streaming trait + SnpSink consumer abstraction",
      "23andMe, AncestryDNA & single-sample VCF parsers refactored onto the stream",
      "DbBatchSink: 50k-row transactional batches, rollback on parse error",
    ],
    next: [
      "1.2 Transparent BGZF/gzip/zstd + tabix region queries",
      "1.3 Full VCF/BCF: multi-sample, INFO/FORMAT, indels/SV",
      "1.6 GRCh37⇄GRCh38 build harmonization (liftover)",
    ],
  },
  pull_requests: [
    { id: 96, title: "Streaming ingestion core", url: "https://github.com/abhilashi/sovereign-dna/pull/96", state: "open" },
    { id: 97, title: "EFA universal format layer", url: "https://github.com/abhilashi/sovereign-dna/pull/97", state: "open" },
  ],
  stack: ["Tauri 2.0", "Rust", "React / TypeScript", "SQLite", "Local LLM (Ollama)"],
  privacy: {
    telemetry: "none",
    raw_dna_leaves_device: false,
    outbound: "public rsIDs / reference queries only, shown in a privacy ledger",
  },
  build: "2026-07-16",
};

function isEmail(s) {
  return typeof s === "string" && /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(s.trim());
}

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

// ── SSE: streaming-ingestion demo ───────────────────────────────────────────
// Deterministically simulates a constant-memory chunked import of a synthetic
// genome, emitting progress the way the real Rust DbBatchSink would.
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
      // Emit in ~40 ticks regardless of size so the UI animates smoothly.
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
          // The whole point: working-set stays flat no matter the file size.
          workingSetKiB: bufferKiB + Math.round((batchSize * bytesPerVariant) / 1024),
          chr: chromosomes[Math.floor((t / ticks) * chromosomes.length)],
          rate: Math.round(perTick / 0.045), // variants/sec (synthetic)
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
      return json({ ok: false, error: "not_found" }, 404);
    }

    // Non-API: serve static assets (index.html, css, js, svg…).
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};
