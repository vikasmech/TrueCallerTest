// Dev-only: runs a throwaway PostgreSQL on port 5433 when Docker is unavailable.
// Usage: pnpm dev:db   (then set DATABASE_URL=postgres://phonerep:phonerep@localhost:5433/phonerep)
import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = Number(process.env.DEV_PG_PORT ?? 5433);
const databaseDir = process.env.DEV_PG_DIR ?? mkdtempSync(join(tmpdir(), "phone-rep-pg-"));
const persistent = Boolean(process.env.DEV_PG_DIR);

const pg = new EmbeddedPostgres({
  databaseDir,
  user: "phonerep",
  password: "phonerep",
  port,
  persistent,
  onLog: () => {},
  onError: (m) => console.error(String(m)),
});

if (!persistent || !(await pg.status().catch(() => false))) {
  await pg.initialise().catch(() => undefined);
}
await pg.start();
await pg.createDatabase("phonerep").catch(() => undefined);
console.log(`postgres ready at postgres://phonerep:phonerep@localhost:${port}/phonerep (data: ${databaseDir})`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
