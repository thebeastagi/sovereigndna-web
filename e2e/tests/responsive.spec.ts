import { test, expect } from "@playwright/test";

/**
 * Runs under every project. Behaviour is asserted relative to the viewport
 * width (breakpoint at 940px): desktop shows inline nav, mobile shows a burger
 * that toggles a dropdown.
 */
test.describe("Responsive layout", () => {
  test("layout is not broken and nav is usable at this viewport", async ({ page }, testInfo) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const vw = page.viewportSize()?.width ?? 1366;

    // No horizontal scroll / overflow (allow a small rounding tolerance).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, "no significant horizontal overflow").toBeLessThanOrEqual(3);

    // Hero + brand always visible.
    await expect(page.locator("section.hero")).toBeVisible();
    await expect(page.locator("header.nav .brand")).toBeVisible();

    if (vw <= 940) {
      // Mobile: burger visible, inline links hidden until toggled.
      const burger = page.locator("#burger");
      await expect(burger).toBeVisible();
      await expect(page.locator("#navlinks")).not.toBeVisible();

      await burger.click();
      await expect(burger).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator("#navlinks")).toBeVisible();

      // Tapping a link closes the menu and navigates to the section.
      await page.locator("#navlinks a", { hasText: "Live demo" }).click();
      await expect(page.locator("#navlinks")).not.toBeVisible();
      await expect(page.locator("#demo")).toBeInViewport({ ratio: 0.05 });
    } else {
      // Desktop: inline nav links visible, burger hidden.
      await expect(page.locator("#navlinks")).toBeVisible();
      await expect(page.locator("#burger")).not.toBeVisible();
      await expect(page.locator("#navlinks").getByRole("link", { name: "Platform" })).toBeVisible();
    }

    // Demo controls stack/flow correctly and the run button is reachable.
    await page.locator("#runBtn").scrollIntoViewIfNeeded();
    await expect(page.locator("#runBtn")).toBeVisible();

    // Waitlist form usable.
    await page.locator("#wlEmail").scrollIntoViewIfNeeded();
    await expect(page.locator("#wlEmail")).toBeVisible();

    await testInfo.attach("viewport", { body: `${vw}px`, contentType: "text/plain" });
  });

  test("key sections render above-the-fold content without clipping", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    for (const id of ["platform", "demo", "privacy", "roadmap", "waitlist"]) {
      const box = await page.locator(`#${id}`).boundingBox();
      expect(box, `section #${id} has a bounding box`).toBeTruthy();
      expect(box!.width, `section #${id} width > 0`).toBeGreaterThan(0);
      expect(box!.height, `section #${id} height > 0`).toBeGreaterThan(0);
    }
  });
});
