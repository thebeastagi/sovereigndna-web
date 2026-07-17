import { test, expect } from "@playwright/test";

test.describe("API contract", () => {
  test("/api/status returns the expected shape", async ({ request }) => {
    const res = await request.get("/api/status");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/json");
    const s = await res.json();

    expect(s.project).toBe("SovereignDNA");
    expect(typeof s.tagline).toBe("string");

    // grant
    expect(s.grant.instrument).toBe("$BEAST");
    expect(s.grant.amount_usd).toBe(80000);

    // phase (legacy summary block)
    expect(typeof s.phase.current).toBe("string");
    expect(s.phase.current).toMatch(/Phase/i);
    expect(typeof s.phase.progress_pct).toBe("number");
    expect(s.phase.progress_pct).toBeGreaterThanOrEqual(0);
    expect(s.phase.progress_pct).toBeLessThanOrEqual(100);
    expect(Array.isArray(s.phase.shipped)).toBe(true);
    expect(s.phase.shipped.length).toBeGreaterThan(0);
    expect(Array.isArray(s.phase.next)).toBe(true);
    expect(s.phase.next.length).toBeGreaterThan(0);

    // phases[] — all four grant phases described
    expect(Array.isArray(s.phases)).toBe(true);
    expect(s.phases.length).toBe(4);
    for (const p of s.phases) {
      expect(typeof p.n).toBe("number");
      expect(typeof p.name).toBe("string");
      expect(typeof p.status).toBe("string");
      expect(Array.isArray(p.prs)).toBe(true);
    }
    const p4 = s.phases.find((p: any) => p.n === 4);
    expect(p4, "phase 4 present").toBeTruthy();
    expect(p4.status).toBe("live-synthetic");
    // Honesty invariant: phase-4 caveat surfaces the synthetic/legal gate.
    expect(String(p4.caveat).toLowerCase()).toMatch(/synthetic/);
    expect(String(p4.caveat).toLowerCase()).toMatch(/legally gated|dpia|audit/);

    // federated — live-synthetic network facts + boundary invariant
    expect(s.federated.status).toBe("live-synthetic");
    expect(s.federated.data).toBe("synthetic only");
    expect(String(s.federated.boundary).toLowerCase()).toContain("dp-noised aggregates cross the boundary");
    expect(String(s.federated.legal_gate).toLowerCase()).toMatch(/dpia|audit|epsilon/);
    expect(typeof s.federated.nodes).toBe("number");

    // payments — reuse the LIVE dashboard /pay flow, no new endpoint
    expect(s.payments.provider).toBe("AllScale");
    expect(s.payments.checkout_url).toBe("https://dash.thebeastagi.com/pay");
    expect(s.payments.live).toBe(true);

    // No $DNA token language anywhere in the status payload.
    expect(JSON.stringify(s)).not.toMatch(/\$DNA|token sale|buy \$/i);

    // pull requests → abhilashi/sovereign-dna#96
    expect(Array.isArray(s.pull_requests)).toBe(true);
    const pr96 = s.pull_requests.find((p: any) => p.id === 96);
    expect(pr96, "PR #96 present").toBeTruthy();
    expect(pr96.url).toBe("https://github.com/abhilashi/sovereign-dna/pull/96");
    for (const pr of s.pull_requests) {
      expect(typeof pr.id).toBe("number");
      expect(typeof pr.title).toBe("string");
      expect(pr.url).toMatch(/^https:\/\/github\.com\/abhilashi\/sovereign-dna\/pull\/\d+$/);
      expect(typeof pr.state).toBe("string");
    }

    // stack + privacy posture
    expect(Array.isArray(s.stack)).toBe(true);
    expect(s.privacy.raw_dna_leaves_device).toBe(false);
    expect(s.privacy.telemetry).toBe("none");

    // freshness marker
    expect(typeof s.now).toBe("string");
    expect(new Date(s.now).toString()).not.toBe("Invalid Date");
  });

  test("/api/privacy-ledger returns entries with no raw DNA", async ({ request }) => {
    const res = await request.get("/api/privacy-ledger");
    expect(res.status()).toBe(200);
    const d = await res.json();
    expect(d.ok).toBe(true);
    expect(Array.isArray(d.entries)).toBe(true);
    expect(d.entries.length).toBeGreaterThan(0);
    for (const e of d.entries) {
      expect(typeof e.ts).toBe("string");
      expect(typeof e.action).toBe("string");
      expect(typeof e.dest).toBe("string");
      // Privacy invariant: no entry ever exfiltrates raw DNA.
      expect(e.raw_dna, `entry "${e.action}" raw_dna flag`).toBe(false);
    }
  });

  test("/api/waitlist/count returns a numeric count", async ({ request }) => {
    const res = await request.get("/api/waitlist/count");
    expect(res.status()).toBe(200);
    const d = await res.json();
    expect(d.ok).toBe(true);
    expect(typeof d.count).toBe("number");
    expect(d.count).toBeGreaterThanOrEqual(0);
  });

  test("unknown /api route → 404 JSON", async ({ request }) => {
    const res = await request.get("/api/does-not-exist");
    expect(res.status()).toBe(404);
    const d = await res.json();
    expect(d.ok).toBe(false);
    expect(d.error).toBe("not_found");
  });

  test("wrong method on waitlist → not matched (404 JSON)", async ({ request }) => {
    // GET on the POST-only /api/waitlist is not a registered route.
    const res = await request.get("/api/waitlist");
    expect(res.status()).toBe(404);
  });

  const DYNAMIC_ROUTES = [
    "/api/status",
    "/api/waitlist/count",
    "/api/privacy-ledger",
    "/api/ingest/stream?variants=100000&format=23andMe",
    "/api/does-not-exist",
  ];

  for (const route of DYNAMIC_ROUTES) {
    test(`security headers present on ${route}`, async ({ request }) => {
      const res = await request.get(route);
      const h = res.headers();
      expect(h["x-content-type-options"], "nosniff").toBe("nosniff");
      expect(h["x-frame-options"], "X-Frame-Options DENY").toBe("DENY");
      expect(h["referrer-policy"], "Referrer-Policy").toBe("strict-origin-when-cross-origin");
      expect(h["permissions-policy"], "Permissions-Policy").toContain("geolocation=()");
      expect(h["cross-origin-opener-policy"], "COOP").toBe("same-origin");
    });
  }
});
