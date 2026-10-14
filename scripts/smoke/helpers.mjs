import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function pass(results, name, detail = {}) {
  results.push({ name, passed: true, ...detail });
  console.log(`PASS ${name}`);
}
export async function waitFor(check, description, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(500);
  }
  throw new Error(`Timed out: ${description}`);
}
export async function developmentLink(logPath, email) {
  const log = await readFile(logPath, "utf8");
  const line = log.split("\n").filter((l) => l.startsWith(`[magic-link] to=${email} `)).at(-1);
  const url = line?.match(/url=(https?:\/\/\S+)/)?.[1];
  assert.ok(url, "development magic link emitted to the private test log");
  return url;
}
