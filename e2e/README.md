# SovereignDNA — E2E Test Suite

End-to-end [Playwright](https://playwright.dev) tests for the SovereignDNA web
app. Tests run against the **live** deployment by default:
`https://sovereigndna.thebeastagi.com`.

## What's covered

| Area | File | Highlights |
|---|---|---|
| Homepage | `tests/homepage.spec.ts` | 200 + title, hero, **helix canvas actually paints pixels**, no console/page errors, no failed requests, assets 200, anchor targets resolve, landmarks |
| Streaming demo | `tests/demo-ingestion.spec.ts` | Worker **SSE** for 23andMe / AncestryDNA / VCF × small+large; monotonic progress; flat peak-RAM working set; `done` fires; UI run → variant count matches selection; naïve-vs-streaming memory gap |
| Waitlist | `tests/waitlist.spec.ts` | unique email → ok+position, dedupe on resubmit, count increments, case-insensitive dedupe, invalid email 422, malformed JSON 400, UI form success + validation |
| API contract | `tests/api-contract.spec.ts` | `/api/status` shape (phase/progress/shipped/next/PR#96), `/api/privacy-ledger` entries (no raw DNA), 404 JSON, **security headers** on every dynamic route |
| Responsive | `tests/responsive.spec.ts` | desktop + mobile viewport; no horizontal overflow; burger nav toggles on mobile |
| Accessibility | `tests/accessibility.spec.ts` | landmarks, keyboard focus reaches controls, `prefers-reduced-motion` pauses the helix, optional axe-core scan (no critical/serious) |

## Run it

```bash
cd e2e
npm install
npx playwright install chromium --only-shell   # if browsers not already present
npm test                                        # full suite vs live
```

Useful variants:

```bash
npm run test:chromium         # desktop Chromium only
npm run test:mobile           # mobile (iPhone-13 metrics on Chromium)
BASE_URL=http://127.0.0.1:8787 npm test   # against a local `wrangler dev`
ENABLE_ALL_BROWSERS=1 npm test            # also Firefox + WebKit (must be installed)
npx playwright test tests/waitlist.spec.ts --project=chromium-desktop
npm run report                # open the HTML report
```

## Waitlist hygiene (important)

The waitlist tests create **synthetic** entries (`e2e+<timestamp>@example.com`).
There is no DELETE API by design, so cleanup happens via KV:

- `utils/global-setup.ts` records the pre-run `wl:count` baseline.
- Tests append every created email to `results/created-emails.txt`.
- `utils/global-teardown.ts` deletes each `wl:<email>` key and restores
  `wl:count` to the baseline via `wrangler kv key …` (requires Cloudflare auth
  in the environment).

To clean up manually after an interrupted run:

```bash
node utils/cleanup-waitlist.mjs
```

No secrets are stored in this suite; wrangler auth is read from the ambient
Cloudflare configuration.
```
