// Local-only end-to-end verification. Never reuses/truncates an application database.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { access, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { runApiSmoke } from "./api.mjs";
import { runBrowserSmoke } from "./browser.mjs";
import { delay, waitFor } from "./helpers.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const requireApi = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const requireWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { Pool } = requireApi("pg");
assert.ok(process.env.SMOKE_DATABASE_URL, "Set SMOKE_DATABASE_URL to a disposable local PostgreSQL server with CREATEDB permission. Do not use production.");
const serverUrl = new URL(process.env.SMOKE_DATABASE_URL);
assert.ok(["postgres:", "postgresql:"].includes(serverUrl.protocol));
await access(join(root, "apps/api/dist/server.js"));
await access(join(root, "apps/worker/dist/index.js"));
await access(join(root, "apps/web/.next/BUILD_ID")).catch(() => { throw new Error("Run pnpm build before pnpm smoke."); });
// Do not let a production-configured build proxy test requests to an external API.
const manifest = JSON.parse(await readFile(join(root, "apps/web/.next/routes-manifest.json"), "utf8"));
const rewrites = Array.isArray(manifest.rewrites) ? manifest.rewrites : Object.values(manifest.rewrites).flat();
assert.ok(rewrites.some((r) => r.source === "/api/:path*" && /^http:\/\/(localhost|127\.0\.0\.1):4000\/:path\*$/.test(r.destination)),
  "Build the website with API_INTERNAL_URL=http://127.0.0.1:4000 before running smoke tests.");
for (const port of [3000, 4000]) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error(`Port ${port} is busy; stop the local dev server first. No existing process will be stopped.`)));
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

const outputDir = await mkdtemp(join(tmpdir(), "phone-rep-smoke-"));
const storageDir = join(outputDir, "staging");
const database = `phone_rep_smoke_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = new URL(serverUrl);
databaseUrl.pathname = "/" + database;
// A URL query can override the database path in pg. Reject ambiguous inputs.
assert.ok(!serverUrl.searchParams.has("database") && !serverUrl.searchParams.has("dbname"), "Use the URL path, not a database query parameter.");
const admin = new Pool({ connectionString: serverUrl.toString(), connectionTimeoutMillis: 5000 });
const apiBase = "http://127.0.0.1:4000", webBase = "http://127.0.0.1:3000";
const apiLogPath = join(outputDir, "api.log");
const env = {
  ...process.env,
  NODE_ENV: "development", DATABASE_URL: databaseUrl.toString(),
  API_PORT: "4000", API_HOST: "127.0.0.1", WEB_BASE_URL: webBase,
  SESSION_SECRET: randomBytes(32).toString("hex"),
  PHONE_HMAC_KEY: randomBytes(32).toString("hex"),
  PHONE_ENC_KEY: randomBytes(32).toString("hex"), PHONE_KEY_VERSION: "1",
  ADMIN_EMAILS: "admin@example.com", MODERATOR_EMAILS: "", MAILER: "console",
  NOTICE_VERSION: "2026-10-v1",
  S3_ENDPOINT: "", LOCAL_STORAGE_DIR: storageDir,
  API_INTERNAL_URL: apiBase, NEXT_TELEMETRY_DISABLED: "1",
};
const children = [], results = [];
let created = false, cleanupPromise;
function start(name, args, overrides = {}, cwd = root) {
  const fd = openSync(join(outputDir, `${name}.log`), "w", 0o600);
  let proc;
  try { proc = spawn(process.execPath, args, { cwd, env: { ...env, ...overrides }, stdio: ["ignore", fd, fd] }); }
  finally { closeSync(fd); }
  const done = new Promise((resolve, reject) => {
    proc.once("error", reject);
    proc.once("close", (code, signal) => code === 0 ? resolve() : reject(new Error(`${name} exited (${code ?? signal}); see its private smoke log.`)));
  });
  // Long-lived services may exit before their health check. Keep the rejection handled.
  done.catch(() => {});
  const child = { name, proc, done };
  children.push(child);
  return child;
}
async function health(child, path) {
  await waitFor(async () => {
    if (child.proc.exitCode !== null || child.proc.signalCode !== null) {
      await child.done;
      throw new Error(`${child.name} stopped before becoming ready.`);
    }
    try { return (await fetch(path, { signal: AbortSignal.timeout(2000) })).ok; }
    catch { return false; }
  }, `${child.name} startup`);
}
function cleanup() {
  return cleanupPromise ??= (async () => {
    await Promise.all(children.map(async ({ proc, done }) => {
      if (proc.exitCode !== null || proc.signalCode !== null) return;
      proc.kill("SIGTERM");
      let timer;
      try {
        await Promise.race([done.catch(() => {}), new Promise((resolve) => {
          timer = setTimeout(() => { proc.kill("SIGKILL"); resolve(); }, 10000);
        })]);
        await done.catch(() => {});
      } finally { clearTimeout(timer); }
    }));
    try {
      if (created) {
        for (let attempt = 0; ; attempt++) {
          try { await admin.query(`DROP DATABASE "${database}"`); break; }
          catch (error) {
            if (error.code !== "55006" || attempt >= 20) throw error;
            await delay(100);
          }
        }
      }
    } finally {
      await admin.end();
      await rm(storageDir, { recursive: true, force: true });
    }
  })();
}
const interrupt = () => { cleanup().finally(() => process.exit(130)); };
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
try {
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  await start("migrate", [join(root, "apps/api/dist/db/migrate.js")]).done;
  await start("seed", [join(root, "apps/api/dist/db/seed.js")]).done;
  const api = start("api", [join(root, "apps/api/dist/server.js")]);
  await health(api, apiBase + "/healthz");
  const worker = start("worker", [join(root, "apps/worker/dist/index.js")]);
  const web = start("web", [requireWeb.resolve("next/dist/bin/next"), "start", "-p", "3000", "-H", "127.0.0.1"],
    { NODE_ENV: "production" }, join(root, "apps/web"));
  await health(web, webBase + "/api/healthz");
  await runApiSmoke({ apiBase, apiLogPath, results });
  await runBrowserSmoke({ webBase, apiLogPath, results, outputDir });
  for (const child of [api, worker, web]) {
    assert.equal(child.proc.exitCode, null, `${child.name} unexpectedly exited`);
    assert.equal(child.proc.signalCode, null);
  }
  console.log(`${results.length} live smoke-check groups passed.`);
} catch (error) {
  results.push({ name: "failure", passed: false, error: String(error) });
  console.error(error);
  process.exitCode = 1;
} finally {
  try { await cleanup(); }
  catch (error) {
    results.push({ name: "cleanup", passed: false, error: String(error) });
    console.error("Smoke cleanup failed:", error);
    process.exitCode = 1;
  }
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  await writeFile(join(outputDir, "results.json"), JSON.stringify(results, null, 2), { mode: 0o600 });
  console.log(`Private logs, results and browser screenshots: ${outputDir}`);
}
