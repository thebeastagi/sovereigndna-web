import { test, expect } from "@playwright/test";
import { attachGuards, THIRD_PARTY_IGNORE } from "../utils/guards";

type SseResult = {
  meta: any;
  progress: any[];
  done: any | null;
  error: string | null;
};

/**
 * Consume the site's own Worker SSE stream in the page context (same-origin
 * EventSource) and collect all events. Returns once `done` fires or on error.
 */
async function runSse(page: any, variants: number, format: string): Promise<SseResult> {
  return page.evaluate(
    ({ variants, format }: { variants: number; format: string }) =>
      new Promise<SseResult>((resolve) => {
        const out: SseResult = { meta: null, progress: [], done: null, error: null };
        const es = new EventSource(
          `/api/ingest/stream?variants=${variants}&format=${encodeURIComponent(format)}`
        );
        const finish = () => {
          try {
            es.close();
          } catch {}
          resolve(out);
        };
        es.addEventListener("meta", (e: any) => (out.meta = JSON.parse(e.data)));
        es.addEventListener("progress", (e: any) => out.progress.push(JSON.parse(e.data)));
        es.addEventListener("done", (e: any) => {
          out.done = JSON.parse(e.data);
          finish();
        });
        es.onerror = () => {
          out.error = "eventsource_error";
          finish();
        };
        // Safety valve.
        setTimeout(finish, 30_000);
      }),
    { variants, format }
  );
}

const FORMATS = ["23andMe", "AncestryDNA", "VCF"] as const;
const SIZES = [
  { label: "small", variants: 100_000 },
  { label: "large", variants: 3_000_000 },
];

test.describe("Streaming ingestion demo — Worker SSE", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
  });

  for (const format of FORMATS) {
    for (const size of SIZES) {
      test(`SSE ${format} · ${size.label} (${size.variants.toLocaleString()} variants) advances monotonically and completes`, async ({
        page,
      }) => {
        const r = await runSse(page, size.variants, format);

        expect(r.error, "no SSE error").toBeNull();

        // meta describes the run and echoes the selected format.
        expect(r.meta, "meta event received").toBeTruthy();
        expect(r.meta.format).toBe(format);
        expect(r.meta.totalVariants).toBe(size.variants);
        expect(r.meta.batchSize).toBe(50000);

        // progress events present and monotonically non-decreasing.
        expect(r.progress.length, "progress events").toBeGreaterThan(1);
        let prevProcessed = -1;
        let prevPct = -1;
        let prevBytes = -1;
        const workingSets = new Set<number>();
        for (const p of r.progress) {
          expect(p.processed, "processed non-decreasing").toBeGreaterThanOrEqual(prevProcessed);
          expect(p.pct, "pct non-decreasing").toBeGreaterThanOrEqual(prevPct);
          expect(p.bytes, "bytes non-decreasing").toBeGreaterThanOrEqual(prevBytes);
          prevProcessed = p.processed;
          prevPct = p.pct;
          prevBytes = p.bytes;
          workingSets.add(p.workingSetKiB);
        }

        // The whole point: working set is FLAT across the entire stream.
        expect(workingSets.size, "peak-RAM meter is flat (single working-set value)").toBe(1);

        // Final progress reaches 100% and full variant count.
        const last = r.progress[r.progress.length - 1];
        expect(last.processed, "final processed == selection").toBe(size.variants);
        expect(last.pct, "final pct").toBeCloseTo(100, 1);

        // done event confirms completion + full count + flat peak memory.
        expect(r.done, "done event received").toBeTruthy();
        expect(r.done.processed, "done processed == selection").toBe(size.variants);
        expect(r.done.peakWorkingSetKiB).toBe([...workingSets][0]);
        expect(r.done.note).toContain("independent of genome size");
      });
    }
  }

  test("peak working set is identical for small vs large genome (flat memory)", async ({ page }) => {
    const small = await runSse(page, 100_000, "VCF");
    const large = await runSse(page, 3_000_000, "VCF");
    expect(small.done.peakWorkingSetKiB).toBe(large.done.peakWorkingSetKiB);
  });

  test("SSE response has correct content-type and security headers", async ({ page }) => {
    const res = await page.request.get("/api/ingest/stream?variants=100000&format=23andMe");
    expect(res.status()).toBe(200);
    const h = res.headers();
    expect(h["content-type"]).toContain("text/event-stream");
    expect(h["cache-control"]).toContain("no-store");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
  });

  test("UI: run ingestion for 23andMe (small) → done, count matches, memory gap shown", async ({
    page,
  }) => {
    const guards = attachGuards(page, { ignore: THIRD_PARTY_IGNORE });

    // Select 23andMe (default) and set a small, exact size.
    await page.locator('#fmtSeg button[data-fmt="23andMe"]').click();
    await expect(page.locator('#fmtSeg button[data-fmt="23andMe"]')).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    // Set slider to an exact value via the DOM + dispatch input event.
    const target = 500_000;
    await page.locator("#sizeRange").evaluate((el: HTMLInputElement, v: number) => {
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, target);
    await expect(page.locator("#sizeVal")).toContainText("500,000");

    await page.locator("#runBtn").click();

    // Button flips to streaming state.
    await expect(page.locator("#runBtn")).toBeDisabled();

    // Wait for completion.
    await expect(page.locator("#demoNote")).toContainText("Done.", { timeout: 30_000 });
    await expect(page.locator("#runBtn")).toBeEnabled();

    // Final variant count in the stat matches the selection.
    await expect(page.locator("#stVariants")).toHaveText("500,000");
    await expect(page.locator("#pctNow")).toHaveText(/100\.0%/);

    // Memory viz: naïve importer far exceeds streaming.
    const naive = await page.locator("#memNaiveV").innerText();
    const stream = await page.locator("#memStreamV").innerText();
    const naiveMB = parseFloat(naive);
    const streamMB = parseFloat(stream);
    expect(naiveMB, "naive importer MB").toBeGreaterThan(streamMB * 5);
    expect(streamMB, "streaming working set stays small/flat").toBeLessThan(10);

    // Naïve bar pinned to 100%, streaming bar much smaller.
    const naiveW = await page.locator("#memNaive").evaluate((e) => (e as HTMLElement).style.width);
    expect(naiveW).toBe("100%");

    expect(guards.pageErrors, "no uncaught errors during demo").toEqual([]);
    expect(guards.consoleErrors, "no console errors during demo").toEqual([]);
  });

  test("UI: switching to VCF (large) runs and completes", async ({ page }) => {
    await page.locator('#fmtSeg button[data-fmt="VCF"]').click();
    await expect(page.locator('#fmtSeg button[data-fmt="VCF"]')).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await page.locator("#sizeRange").evaluate((el: HTMLInputElement) => {
      el.value = el.max; // 3,000,000
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.locator("#runBtn").click();
    await expect(page.locator("#demoNote")).toContainText("Done.", { timeout: 30_000 });
    await expect(page.locator("#stVariants")).toHaveText("3,000,000");
  });
});
