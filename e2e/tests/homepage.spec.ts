import { test, expect } from "@playwright/test";
import { attachGuards, THIRD_PARTY_IGNORE } from "../utils/guards";

test.describe("Homepage", () => {
  test("loads 200 with correct title, hero, and no errors", async ({ page }) => {
    const guards = attachGuards(page, { ignore: THIRD_PARTY_IGNORE });

    const resp = await page.goto("/", { waitUntil: "networkidle" });
    expect(resp, "navigation response present").toBeTruthy();
    expect(resp!.status(), "homepage HTTP status").toBe(200);
    expect(resp!.headers()["content-type"] || "").toContain("text/html");

    await expect(page).toHaveTitle(/SovereignDNA/);
    await expect(page).toHaveTitle(/Your genome, your device/);

    // Hero present and on-mission (North Star front-and-centre)
    await expect(page.locator("section.hero")).toBeVisible();
    await expect(page.locator("h1")).toContainText("Your genome");
    await expect(page.locator(".hero .sub")).toContainText(/Variants of Unknown Significance/i);
    await expect(page.locator(".hero .sub")).toContainText(/without your DNA ever leaving your device/i);
    await expect(page.getByRole("link", { name: /See the mission/i })).toBeVisible();

    // Nav + primary CTA
    await expect(page.locator("header.nav .brand")).toBeVisible();
    await expect(page.getByRole("link", { name: /Get access/i }).first()).toBeVisible();

    // Status chip hydrates from /api/status (four-phase build state or progress %).
    await expect(page.locator("#statusText")).toContainText(/Phases 1[–-]4 built|FL live|%/, { timeout: 15_000 });

    // No uncaught JS/console errors, no failed same-origin requests.
    expect(guards.pageErrors, "uncaught page errors").toEqual([]);
    expect(guards.consoleErrors, "console errors").toEqual([]);
    expect(guards.failedRequests, "failed network requests").toEqual([]);
    expect(guards.badResponses, "4xx/5xx same-origin responses").toEqual([]);
  });

  test("helix canvas is actually painting non-blank pixels", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const canvas = page.locator("#helix");
    await expect(canvas).toBeVisible();

    // Give the animation a couple of frames to paint.
    await page.waitForTimeout(600);

    const painted = await canvas.evaluate((el: HTMLCanvasElement) => {
      const c = el as HTMLCanvasElement;
      if (!c.width || !c.height) return { ok: false, reason: "zero-size", nonBlank: 0 };
      const ctx = c.getContext("2d");
      if (!ctx) return { ok: false, reason: "no-2d-context", nonBlank: 0 };
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      let nonBlank = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 0) nonBlank++; // any non-transparent pixel
      }
      return { ok: true, reason: "", nonBlank, total: data.length / 4, w: c.width, h: c.height };
    });

    expect(painted.ok, `canvas paint check: ${painted.reason}`).toBeTruthy();
    // Expect a meaningful number of painted pixels (the helix strands/nodes).
    expect(painted.nonBlank, "non-transparent pixels on helix canvas").toBeGreaterThan(200);
  });

  test("core assets load and internal anchor links resolve", async ({ page }) => {
    const guards = attachGuards(page, { ignore: THIRD_PARTY_IGNORE });
    await page.goto("/", { waitUntil: "networkidle" });

    // Key first-party assets return 200.
    for (const asset of ["/styles.css", "/app.js", "/favicon.svg", "/robots.txt"]) {
      const r = await page.request.get(asset);
      expect(r.status(), `asset ${asset}`).toBe(200);
    }

    // Every in-page anchor link points at an element that exists.
    const anchors = await page.locator('a[href^="#"]').evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).getAttribute("href")!).filter((h) => h && h.length > 1)
    );
    for (const href of new Set(anchors)) {
      const id = href.slice(1);
      await expect(page.locator(`[id="${id}"]`), `anchor target ${href}`).toHaveCount(1);
    }

    expect(guards.failedRequests, "no failed asset requests").toEqual([]);
    expect(guards.badResponses, "no 4xx/5xx asset responses").toEqual([]);
  });

  test("semantic landmarks + section structure present", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header.nav")).toHaveCount(1);
    await expect(page.locator("footer")).toHaveCount(1);
    // The primary <nav aria-label="Primary"> exists in the DOM on every
    // viewport; on mobile it is display:none behind the burger (so not an
    // exposed/visible role there) — assert structural presence.
    await expect(page.locator('nav[aria-label="Primary"]')).toHaveCount(1);
    for (const id of ["mission", "product", "capabilities", "demo", "phases", "federated", "privacy", "roadmap", "access", "waitlist"]) {
      await expect(page.locator(`#${id}`), `section #${id}`).toHaveCount(1);
    }
    // Exactly one H1.
    await expect(page.locator("h1")).toHaveCount(1);
  });

  test("product story: mission, capabilities catalogue, and evidence ladder render", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    // Mission — the VUS problem framing with honest sourced numbers.
    await expect(page.locator("#mission")).toContainText(/Variants of Uncertain Significance|VUS/);
    await expect(page.locator("#mission .vus-stat")).toHaveCount(4);
    await expect(page.locator("#mission")).toContainText(/44\.6%/);
    // KPI present.
    await expect(page.locator("#mission")).toContainText(/toward zero/i);

    // Capabilities — 11 families + TOP-20 grid hydrated from /api/status.
    await expect(page.locator("#capabilities .fam-card")).toHaveCount(11);
    await expect(page.locator("#capabilities")).toContainText(/110 skills/);
    const skills = page.locator("#capabilities .skill-card");
    await expect.poll(async () => skills.count(), { timeout: 15_000 }).toBe(20);
    await expect(skills.first()).toContainText(/Ancestry-stratified allele-frequency/i);

    // Trust — evidence ladder L0→L4, honesty about candidates vs clinical.
    await expect(page.locator("#federated .ladder-steps li")).toHaveCount(5);
    await expect(page.locator("#federated")).toContainText(/submission to expert panels, never a verdict/i);

    // Boundary rule appears in the hero and the trust section.
    await expect(page.locator("body")).toContainText(/only DP-noised aggregates cross the boundary/i);
  });

  test("no token-sale / \\$DNA language anywhere on the page", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/\$DNA/);
    expect(text).not.toMatch(/token sale|buy \$|ticker|presale|token price/i);
  });
});
