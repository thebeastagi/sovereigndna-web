import type { FullConfig } from "@playwright/test";
// @ts-ignore - plain ESM helper
import { saveBaseline } from "./state.mjs";

/**
 * Capture the pre-test waitlist count so teardown can restore it exactly.
 */
export default async function globalSetup(config: FullConfig) {
  const base =
    process.env.BASE_URL ||
    (config.projects[0]?.use?.baseURL as string) ||
    "https://sovereigndna.thebeastagi.com";
  try {
    const res = await fetch(`${base}/api/waitlist/count`);
    const data: any = await res.json();
    const count = typeof data.count === "number" ? data.count : 0;
    saveBaseline(count);
    // eslint-disable-next-line no-console
    console.log(`[global-setup] waitlist baseline count = ${count}`);
  } catch (err) {
    saveBaseline(0);
    // eslint-disable-next-line no-console
    console.warn(`[global-setup] could not read baseline count, assuming 0:`, err);
  }
}
