import { test, expect } from "@playwright/test";
// @ts-ignore - plain ESM helper
import { recordCreatedEmail } from "../utils/state.mjs";

const uniqueEmail = () =>
  `e2e+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

test.describe("Waitlist flow", () => {
  test("new email → ok + position + not deduped; count increments by 1", async ({ request }) => {
    const before = await (await request.get("/api/waitlist/count")).json();
    expect(before.ok).toBe(true);
    const startCount = before.count;

    const email = uniqueEmail();
    recordCreatedEmail(email); // ensure teardown removes it even if asserts fail

    const res = await request.post("/api/waitlist", { data: { email, role: "developer" } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deduped).toBe(false);
    expect(typeof body.position).toBe("number");
    expect(body.position).toBeGreaterThan(0);

    const after = await (await request.get("/api/waitlist/count")).json();
    expect(after.count, "count increments by exactly 1").toBe(startCount + 1);
    expect(body.position, "position reflects new count").toBe(after.count);
  });

  test("resubmitting the same email → deduped:true, same position, count unchanged", async ({
    request,
  }) => {
    const email = uniqueEmail();
    recordCreatedEmail(email);

    const first = await (await request.post("/api/waitlist", { data: { email } })).json();
    expect(first.ok).toBe(true);
    expect(first.deduped).toBe(false);

    const countAfterFirst = (await (await request.get("/api/waitlist/count")).json()).count;

    const second = await (await request.post("/api/waitlist", { data: { email } })).json();
    expect(second.ok).toBe(true);
    expect(second.deduped, "second submit is deduped").toBe(true);
    expect(second.position, "position preserved on dedupe").toBe(first.position);

    const countAfterSecond = (await (await request.get("/api/waitlist/count")).json()).count;
    expect(countAfterSecond, "count unchanged on dedupe").toBe(countAfterFirst);
  });

  test("invalid email → 422 validation error, count unchanged", async ({ request }) => {
    const before = (await (await request.get("/api/waitlist/count")).json()).count;

    for (const bad of ["not-an-email", "foo@", "@bar.com", "a b@c.com", ""]) {
      const res = await request.post("/api/waitlist", { data: { email: bad } });
      expect(res.status(), `reject "${bad}"`).toBe(422);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error).toBe("invalid_email");
    }

    // Malformed JSON → 400. Send raw bytes via Buffer so Playwright does not
    // re-serialize the string into a valid JSON string literal.
    const badJson = await request.post("/api/waitlist", {
      headers: { "content-type": "application/json" },
      data: Buffer.from("{not-json"),
    });
    expect(badJson.status()).toBe(400);
    expect((await badJson.json()).error).toBe("invalid_json");

    const after = (await (await request.get("/api/waitlist/count")).json()).count;
    expect(after, "invalid submissions do not change count").toBe(before);
  });

  test("email is normalized (case-insensitive dedupe)", async ({ request }) => {
    const base = uniqueEmail();
    const upper = base.toUpperCase();
    recordCreatedEmail(base); // worker lowercases → wl:<lowercase>

    const a = await (await request.post("/api/waitlist", { data: { email: base } })).json();
    const b = await (await request.post("/api/waitlist", { data: { email: upper } })).json();
    expect(a.ok && b.ok).toBe(true);
    expect(b.deduped, "uppercase variant dedupes to same entry").toBe(true);
    expect(b.position).toBe(a.position);
  });

  test("UI: submit via the on-page form shows success + position", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const email = uniqueEmail();
    recordCreatedEmail(email);

    await page.locator("#wlEmail").fill(email);
    await page.locator("#wlRole").selectOption("user");
    await page.locator("#wlBtn").click();

    await expect(page.locator("#wlResult.ok")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#wlResult")).toContainText(/Position #/i);
    // Count label updates.
    await expect(page.locator("#wlCount")).toContainText(/on the list|first/i);
  });

  test("UI: invalid email shows client-side validation error", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.locator("#wlEmail").fill("nope");
    await page.locator("#wlBtn").click();
    await expect(page.locator("#wlResult.err")).toBeVisible();
    await expect(page.locator("#wlResult")).toContainText(/valid email/i);
  });
});
