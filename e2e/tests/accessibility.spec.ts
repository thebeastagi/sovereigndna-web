import { test, expect } from "@playwright/test";

// axe-core is optional — loaded lazily inside the scan test so the suite runs
// even when the dependency is absent.
async function loadAxe(): Promise<any> {
  try {
    // @ts-ignore - optional dependency
    return (await import("@axe-core/playwright")).default;
  } catch {
    return null;
  }
}

test.describe("Accessibility smoke", () => {
  test("semantic landmarks present", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toHaveCount(1);
    await expect(page.locator("footer")).toHaveCount(1);
    // Structural landmark check (the <nav> collapses behind the burger on
    // mobile, so it is display:none and absent from the a11y role tree there —
    // assert DOM presence rather than the exposed role for viewport-robustness).
    await expect(page.locator("nav")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveCount(1);
    // Form controls have accessible names.
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByRole("group", { name: /Source format/i })).toBeVisible();
  });

  test("keyboard focus reaches interactive controls", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "keyboard tab-order is a desktop concern");
    await page.goto("/", { waitUntil: "networkidle" });

    // Tab through the document and collect which key controls receive focus.
    const wanted = new Set(["runBtn", "sizeRange", "wlEmail", "wlBtn", "wlRole", "burger"]);
    const seen = new Set<string>();
    const seenTags = new Set<string>();

    await page.locator("body").click({ position: { x: 2, y: 2 } });
    for (let i = 0; i < 60 && seen.size < wanted.size; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el ? { id: el.id, tag: el.tagName.toLowerCase() } : { id: "", tag: "" };
      });
      if (info.id && wanted.has(info.id)) seen.add(info.id);
      if (info.tag) seenTags.add(info.tag);
    }

    // At least the run button, email field and submit button should be tabbable.
    for (const id of ["runBtn", "wlEmail", "wlBtn"]) {
      expect(seen.has(id), `#${id} reachable via keyboard`).toBeTruthy();
    }
    // Links/buttons participate in the tab order.
    expect([...seenTags].some((t) => ["a", "button", "input", "select"].includes(t))).toBeTruthy();
  });

  test("prefers-reduced-motion pauses the helix animation", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/", { waitUntil: "networkidle" });

    // Whether requestAnimationFrame keeps running is the tell: under reduced
    // motion, app.js does not schedule further frames (phase stops advancing).
    // We sample the canvas twice; it should be static (identical) when paused.
    const sample = () =>
      page.locator("#helix").evaluate((el: HTMLCanvasElement) => {
        const ctx = (el as HTMLCanvasElement).getContext("2d")!;
        const d = ctx.getImageData(0, 0, el.width, el.height).data;
        // cheap checksum
        let h = 0;
        for (let i = 0; i < d.length; i += 997) h = (h + d[i]) % 1000000007;
        return h;
      });

    const a = await sample();
    await page.waitForTimeout(400);
    const b = await sample();
    expect(b, "canvas is static under prefers-reduced-motion").toBe(a);

    // But it still painted the initial frame (not blank).
    const painted = await page.locator("#helix").evaluate((el: HTMLCanvasElement) => {
      const ctx = (el as HTMLCanvasElement).getContext("2d")!;
      const d = ctx.getImageData(0, 0, el.width, el.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) n++;
      return n;
    });
    expect(painted, "helix still renders one static frame").toBeGreaterThan(100);

    await context.close();
  });

  test("axe-core scan reports no critical/serious violations", async ({ page }, testInfo) => {
    const AxeBuilder = await loadAxe();
    test.skip(!AxeBuilder, "@axe-core/playwright not installed — skipping automated scan");
    await page.goto("/", { waitUntil: "networkidle" });

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    const serious = results.violations.filter(
      (v: any) => v.impact === "critical" || v.impact === "serious"
    );

    // Attach full report for the record.
    await testInfo.attach("axe-violations.json", {
      body: JSON.stringify(results.violations, null, 2),
      contentType: "application/json",
    });

    // Report all, hard-fail only on critical/serious.
    if (results.violations.length) {
      console.log(
        "axe violations:",
        results.violations.map((v: any) => `${v.impact}:${v.id}`).join(", ")
      );
    }
    expect(serious, `critical/serious a11y violations: ${serious.map((v: any) => v.id).join(", ")}`).toEqual(
      []
    );
  });
});
