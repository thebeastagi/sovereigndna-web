// @ts-ignore - plain ESM helpers
import { kvDelete, kvPut } from "./kv.mjs";
// @ts-ignore
import { readBaseline, readCreatedEmails, clearCreatedEmails } from "./state.mjs";

/**
 * Clean up every synthetic waitlist entry the suite created, and restore the
 * `wl:count` key to the baseline captured in global setup. Leaves the live KV
 * exactly as it was found (previous run left it at 0).
 */
export default async function globalTeardown() {
  const emails: string[] = readCreatedEmails();
  const baseline = readBaseline();

  if (emails.length === 0) {
    // eslint-disable-next-line no-console
    console.log("[global-teardown] no synthetic waitlist entries to clean up.");
    return;
  }

  let deleted = 0;
  for (const email of emails) {
    try {
      kvDelete(`wl:${email}`);
      deleted++;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[global-teardown] failed to delete wl:${email}:`, (err as Error).message);
    }
  }

  try {
    kvPut("wl:count", String(baseline.count ?? 0));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[global-teardown] failed to reset wl:count:`, (err as Error).message);
  }

  clearCreatedEmails();
  // eslint-disable-next-line no-console
  console.log(
    `[global-teardown] deleted ${deleted}/${emails.length} synthetic entries; ` +
      `wl:count restored to ${baseline.count ?? 0}.`
  );
}
