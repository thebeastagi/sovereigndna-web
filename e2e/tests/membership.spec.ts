import { test, expect } from "@playwright/test";

/**
 * Membership + AllScale payment rails.
 *
 * SAFETY: these tests NEVER charge a real card. Paid checkout mints only
 * non-charging AllScale hosted-checkout intents, and that live-mint path is
 * gated behind RUN_LIVE_MINT=1 so ordinary CI runs make zero external calls.
 * Everything else exercises validation, gating, rendering and security only.
 *
 * The free-join test uses a single deterministic email so re-runs are
 * idempotent (deduped) and never grow KV.
 */

const FREE_EMAIL = "e2e-free-member@sovereigndna.test";
const ABSENT_EMAIL = "e2e-absent-nobody-9f2a@sovereigndna.test";

test.describe("Membership — tier catalog API", () => {
  test("GET /api/member/tiers returns Free / Sovereign / Founder", async ({ request }) => {
    const res = await request.get("/api/member/tiers");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/json");
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(Array.isArray(j.tiers)).toBe(true);
    const ids = j.tiers.map((t: any) => t.id).sort();
    expect(ids).toEqual(["founder", "free", "sovereign"]);
    const free = j.tiers.find((t: any) => t.id === "free");
    expect(free.amount_cents).toBe(0);
    expect(free.paid).toBe(false);
    for (const t of j.tiers) {
      expect(typeof t.name).toBe("string");
      expect(typeof t.amount_cents).toBe("number");
      expect(Array.isArray(t.features)).toBe(true);
      expect(t.features.length).toBeGreaterThan(0);
    }
    // pricing must be flagged adjustable
    expect(String(j.pricing_note || "")).toMatch(/adjustable|placeholder/i);
  });

  test("tiers API carries hardened security headers", async ({ request }) => {
    const res = await request.get("/api/member/tiers");
    const h = res.headers();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["referrer-policy"]).toContain("strict-origin");
  });
});

test.describe("Membership — checkout validation", () => {
  test("rejects an unknown tier", async ({ request }) => {
    const res = await request.post("/api/member/checkout", {
      data: { email: "someone@example.com", tier: "diamond" },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe("invalid_tier");
  });

  test("rejects an invalid email", async ({ request }) => {
    const res = await request.post("/api/member/checkout", {
      data: { email: "not-an-email", tier: "free" },
    });
    expect(res.status()).toBe(422);
    expect((await res.json()).error).toBe("invalid_email");
  });

  test("rejects malformed JSON", async ({ request }) => {
    // Buffer is transmitted verbatim (a raw string can be re-encoded by the client).
    const res = await request.post("/api/member/checkout", {
      headers: { "Content-Type": "application/json" },
      data: Buffer.from("{not valid json"),
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("Membership — free tier activation + gating", () => {
  test("free join activates immediately and is idempotent", async ({ request }) => {
    const res = await request.post("/api/member/checkout", {
      data: { email: FREE_EMAIL, tier: "free" },
    });
    expect(res.status()).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.tier).toBe("free");
    expect(j.status).toBe("active");

    // status reflects the active free membership
    const st = await request.get(`/api/member/status?email=${encodeURIComponent(FREE_EMAIL)}`);
    expect(st.status()).toBe(200);
    const sj = await st.json();
    expect(sj.found).toBe(true);
    expect(sj.tier).toBe("free");
    expect(sj.status).toBe("active");
    expect(sj.benefits_unlocked).toBe(false); // premium benefit is paid-only
  });

  test("premium early-access is blocked for free members", async ({ request }) => {
    // ensure the free member exists first
    await request.post("/api/member/checkout", { data: { email: FREE_EMAIL, tier: "free" } });
    const res = await request.get(`/api/member/early-access?email=${encodeURIComponent(FREE_EMAIL)}`);
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toBe("membership_required");
  });

  test("status for an unknown email is a clean not-found", async ({ request }) => {
    const res = await request.get(`/api/member/status?email=${encodeURIComponent(ABSENT_EMAIL)}`);
    expect(res.status()).toBe(200);
    const j = await res.json();
    expect(j.found).toBe(false);
    expect(j.status).toBe("none");
  });

  test("early-access for an unknown email is forbidden", async ({ request }) => {
    const res = await request.get(`/api/member/early-access?email=${encodeURIComponent(ABSENT_EMAIL)}`);
    expect(res.status()).toBe(403);
  });
});

test.describe("Membership — webhook is authenticated (never accepts unsigned)", () => {
  test("unsigned AllScale webhook is rejected (401 or 503, never 200)", async ({ request }) => {
    const res = await request.post("/api/payments/allscale/webhook", {
      data: { status: "paid", checkout_intent_id: "forged", order_id: "forged" },
    });
    // 503 until the shared secret is provisioned; 401 once it is. Never 2xx.
    expect([401, 503]).toContain(res.status());
    expect(res.status()).toBeGreaterThanOrEqual(400);
    const j = await res.json();
    expect(j.status).not.toBe("accepted");
  });

  test("webhook with bogus signature headers is rejected", async ({ request }) => {
    const res = await request.post("/api/payments/allscale/webhook", {
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Id": "x",
        "X-Webhook-Timestamp": String(Math.floor(Date.now() / 1000)),
        "X-Webhook-Nonce": "n",
        "X-Webhook-Signature": "v1=not-a-real-signature",
      },
      data: { status: "paid", checkout_intent_id: "forged" },
    });
    expect([401, 503]).toContain(res.status());
    expect((await res.json()).status).not.toBe("accepted");
  });
});

test.describe("Membership — page renders", () => {
  test("membership page shows all three tiers with prices + adjustable note", async ({ page }) => {
    await page.goto("/membership");
    await expect(page).toHaveTitle(/Membership/i);
    // tiers loaded from the API
    const tiers = page.locator(".tier");
    await expect(tiers).toHaveCount(3, { timeout: 15_000 });
    await expect(page.locator(".tier", { hasText: "Free" }).first()).toBeVisible();
    await expect(page.locator(".tier", { hasText: "Sovereign" }).first()).toBeVisible();
    await expect(page.locator(".tier", { hasText: "Founder" }).first()).toBeVisible();
    // a price is rendered
    await expect(page.locator(".tier .price").first()).toBeVisible();
    // adjustable pricing disclosure
    await expect(page.locator("#pricingNote")).toContainText(/adjustable|placeholder/i);
    // checkout + member sections exist
    await expect(page.locator("#memForm")).toBeVisible();
    await expect(page.locator("#statusForm")).toBeVisible();
  });

  test("selecting a paid tier updates the checkout selection", async ({ page }) => {
    await page.goto("/membership");
    await expect(page.locator(".tier")).toHaveCount(3, { timeout: 15_000 });
    await page.locator('.tier button[data-tier="sovereign"]').click();
    await expect(page.locator("#selectedTier")).toContainText(/Sovereign/);
    await expect(page.locator("#memTier")).toHaveValue("sovereign");
  });

  test("post-payment thanks page renders", async ({ page }) => {
    await page.goto("/membership/thanks");
    await expect(page).toHaveTitle(/Thank you/i);
    await expect(page.locator("text=Check my membership status")).toBeVisible();
  });

  test("nav links from home to membership", async ({ page }) => {
    await page.goto("/");
    const link = page.locator('.nav-links a[href="/membership"]');
    await expect(link).toHaveCount(1);
  });
});

test.describe("Membership — live non-charging mint (opt-in)", () => {
  test.skip(!process.env.RUN_LIVE_MINT, "set RUN_LIVE_MINT=1 to exercise the live AllScale mint (non-charging)");
  test("paid checkout mints a hosted-checkout URL (no charge)", async ({ request }) => {
    const res = await request.post("/api/member/checkout", {
      data: { email: "e2e-live-mint@sovereigndna.test", tier: "sovereign" },
    });
    // ok → real non-charging checkout_url; or a clean unavailable state.
    if (res.ok()) {
      const j = await res.json();
      expect(j.status).toBe("pending");
      expect(String(j.checkout_url)).toMatch(/^https:\/\//);
    } else {
      expect([502, 503]).toContain(res.status());
    }
  });
});
