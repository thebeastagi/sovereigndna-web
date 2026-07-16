import type { Page, ConsoleMessage, Request } from "@playwright/test";

export interface PageGuards {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: { url: string; failure: string | null }[];
  badResponses: { url: string; status: number }[];
}

/**
 * Attach listeners that record uncaught page errors, console errors, failed
 * network requests, and 4xx/5xx responses for same-origin/asset requests.
 * Returns collectors the test can assert against.
 *
 * `ignore` filters out known-noise URLs (e.g. third-party font CSS quirks).
 */
export function attachGuards(page: Page, opts: { ignore?: (RegExp | string)[] } = {}): PageGuards {
  const g: PageGuards = { consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [] };
  const ignore = opts.ignore ?? [];
  const isIgnored = (url: string) =>
    ignore.some((p) => (typeof p === "string" ? url.includes(p) : p.test(url)));

  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // favicon/font 3rd-party console noise is not an app error
      if (!isIgnored(text)) g.consoleErrors.push(text);
    }
  });

  page.on("pageerror", (err: Error) => {
    g.pageErrors.push(`${err.name}: ${err.message}`);
  });

  page.on("requestfailed", (req: Request) => {
    const url = req.url();
    if (isIgnored(url)) return;
    // aborted EventSource connections on navigation are expected; ignore SSE aborts
    const failure = req.failure()?.errorText ?? null;
    if (url.includes("/api/ingest/stream") && failure && /aborted|ERR_ABORTED/i.test(failure)) return;
    g.failedRequests.push({ url, failure });
  });

  page.on("response", (res) => {
    const url = res.url();
    if (isIgnored(url)) return;
    const status = res.status();
    // Only flag same-origin + asset failures; ignore expected 404 probes done in tests explicitly.
    if (status >= 400 && !url.includes("/api/waitlist") /* validation tests hit 4xx on purpose */) {
      // Third-party fonts occasionally 4xx under bot UA — ignore cross-origin.
      try {
        const u = new URL(url);
        if (u.hostname.endsWith("thebeastagi.com")) g.badResponses.push({ url, status });
      } catch {
        /* ignore parse errors */
      }
    }
  });

  return g;
}

// Third-party noise we never want to fail the whole suite on.
export const THIRD_PARTY_IGNORE = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
];
