#!/usr/bin/env node
/**
 * Standalone waitlist cleanup — deletes every synthetic `wl:<email>` entry the
 * suite recorded in results/created-emails.txt and restores `wl:count` to the
 * baseline captured in results/baseline.json. Safe to run after an interrupted
 * test run. Requires wrangler auth in the environment.
 */
import { kvDelete, kvPut } from "./kv.mjs";
import { readBaseline, readCreatedEmails, clearCreatedEmails } from "./state.mjs";

const emails = readCreatedEmails();
const baseline = readBaseline();

if (emails.length === 0) {
  console.log("[cleanup] nothing recorded to clean up.");
} else {
  let ok = 0;
  for (const email of emails) {
    try {
      kvDelete(`wl:${email}`);
      ok++;
      console.log(`[cleanup] deleted wl:${email}`);
    } catch (e) {
      console.warn(`[cleanup] failed wl:${email}: ${e.message}`);
    }
  }
  try {
    kvPut("wl:count", String(baseline.count ?? 0));
    console.log(`[cleanup] wl:count restored to ${baseline.count ?? 0}`);
  } catch (e) {
    console.warn(`[cleanup] failed to reset wl:count: ${e.message}`);
  }
  clearCreatedEmails();
  console.log(`[cleanup] done — ${ok}/${emails.length} entries removed.`);
}
