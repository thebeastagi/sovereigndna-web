/**
 * Shared run state between global setup, tests, and teardown — persisted to
 * disk so it survives across Playwright worker processes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "results");
const BASELINE = path.join(DIR, "baseline.json");
const CREATED = path.join(DIR, "created-emails.txt");

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true });
}

export function saveBaseline(count) {
  ensureDir();
  fs.writeFileSync(BASELINE, JSON.stringify({ count, ts: new Date().toISOString() }, null, 2));
}

export function readBaseline() {
  try {
    return JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  } catch {
    return { count: 0 };
  }
}

/** Append a created email (idempotent-ish; dedupe on read). */
export function recordCreatedEmail(email) {
  ensureDir();
  fs.appendFileSync(CREATED, email.trim().toLowerCase() + "\n");
}

export function readCreatedEmails() {
  try {
    const raw = fs.readFileSync(CREATED, "utf8");
    return [...new Set(raw.split("\n").map((s) => s.trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

export function clearCreatedEmails() {
  try {
    fs.unlinkSync(CREATED);
  } catch {
    /* nothing to clear */
  }
}
