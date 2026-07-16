# SovereignDNA — web app

The public web app for **SovereignDNA**, a local-first, privacy-preserving DNA agent workbench,
built with [The Beast](https://thebeastagi.com) under the milestone-gated **$80K $BEAST** grant.

🌐 **Live:** https://sovereigndna.thebeastagi.com

This is a **full-stack Cloudflare Worker** — a static frontend served from `./public` via the
Workers Static Assets binding, plus a real backend API (`src/worker.js`) with KV-backed state
and a live server-sent-events streaming demo.

## What it does

### Frontend (`public/`)
A dark, premium genomics/privacy site: animated DNA-helix hero, platform pillars, an **interactive
streaming-ingestion demo**, Phase-1 progress pulled live from the API, a privacy-ledger table, the
grant roadmap, and a KV-backed waitlist. Responsive, accessible (reduced-motion aware, semantic
landmarks, keyboard-navigable), zero third-party trackers.

### Backend API (`src/worker.js`)
| Route | Method | Purpose |
|---|---|---|
| `/api/status` | GET | Live platform status: phase, progress, shipped/next, PR links, stack. |
| `/api/waitlist` | POST | Join the waitlist. Validates + dedupes email, persists to KV, returns position. |
| `/api/waitlist/count` | GET | Current waitlist size. |
| `/api/ingest/stream` | GET | **SSE** stream simulating the real constant-memory streaming genome import (synthetic data). |
| `/api/privacy-ledger` | GET | Sample privacy-ledger entries (synthetic). |

The streaming demo mirrors the real Phase-1.1 work shipped in
[`abhilashi/sovereign-dna#96`](https://github.com/abhilashi/sovereign-dna/pull/96): a 256 KiB buffered
reader → per-variant sink → 50k-row transactional SQLite batches, so peak memory stays **flat**
regardless of genome size.

## Develop

```bash
npm i -g wrangler        # or use npx
npx wrangler dev --local # http://localhost:8787
```

## Deploy

```bash
npx wrangler deploy      # maps sovereigndna.thebeastagi.com (custom domain)
```

Requires Cloudflare credentials in the environment (never commit them). The waitlist KV namespace
is bound as `SOVDNA_KV` in `wrangler.toml`.

## Constraints honored
- No secrets, tokens, or credentials in the repo.
- Synthetic / sample data only — no real genomic data anywhere.
- Same-origin design; static assets + API on one Worker.

---
**Not medical advice.** SovereignDNA is a wellness, research and education tool for user-controlled
analysis. MIT licensed. © 2026 · built with The Beast.
