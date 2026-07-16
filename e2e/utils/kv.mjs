/**
 * KV helpers for waitlist test hygiene.
 *
 * The SovereignDNA Worker has no DELETE endpoint for waitlist entries (by
 * design — it is a public signup store). The E2E suite therefore cleans up the
 * synthetic entries it creates by talking to the KV namespace directly via
 * wrangler, restoring `wl:count` to the baseline captured before the run.
 *
 * Requires wrangler auth in the environment (Cloudflare API key). No secrets
 * are stored here — auth is read from the ambient wrangler/CF configuration.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const NAMESPACE_ID = "16ecad3d5d8b4fb3b327ece7d9db84ca";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function wrangler(args) {
  return execFileSync("npx", ["wrangler", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  });
}

export function kvDelete(key) {
  wrangler(["kv", "key", "delete", key, `--namespace-id=${NAMESPACE_ID}`, "--remote"]);
}

export function kvPut(key, value) {
  wrangler(["kv", "key", "put", key, value, `--namespace-id=${NAMESPACE_ID}`, "--remote"]);
}
