import { eq } from "drizzle-orm";
import {
  QUEUES,
  createBoss,
  createDb,
  createPhoneCrypto,
  createPool,
  createStorageFromEnv,
  enqueueRecompute,
  expireStagingFiles,
  loadEnv,
  recomputeReputation,
  runImportCommit,
  runImportParse,
  runImportRollback,
  stalePhoneIds,
  tables,
  type ImportBatchJob,
  type ImportDeps,
  type RecomputeJob,
} from "@phone-rep/api";

const env = loadEnv();
const pool = createPool(env.DATABASE_URL);
const db = createDb(pool);
const boss = createBoss(env.DATABASE_URL);
boss.on("error", (err) => console.error("[pg-boss]", err));

const crypto = createPhoneCrypto({
  hmacKeyHex: env.PHONE_HMAC_KEY,
  encKeyHex: env.PHONE_ENC_KEY,
  keyVersion: env.PHONE_KEY_VERSION,
});
const storage = createStorageFromEnv(env);
const deps: ImportDeps = { db, pool, boss, crypto, storage };

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

await boss.start();

await boss.work<RecomputeJob>(QUEUES.recomputeReputation, { teamSize: 4, teamConcurrency: 2 }, async (job) => {
  await recomputeReputation(db, job.data.phoneId);
  log("recomputed", { phoneId: job.data.phoneId });
});

await boss.work(QUEUES.refreshStale, async () => {
  const ids = await stalePhoneIds(db);
  for (const phoneId of ids) await enqueueRecompute(boss, phoneId);
  log("refresh-stale enqueued", { count: ids.length });
});

await boss.work<ImportBatchJob>(QUEUES.importParse, async (job) => {
  try {
    await runImportParse(deps, job.data.batchId);
    log("import parsed", { batchId: job.data.batchId });
  } catch (err) {
    await db
      .update(tables.importBatches)
      .set({ state: "parse_failed", error: String((err as Error).message).slice(0, 500) })
      .where(eq(tables.importBatches.id, job.data.batchId));
    throw err;
  }
});

await boss.work<ImportBatchJob>(QUEUES.importCommit, { teamConcurrency: 1 }, async (job) => {
  try {
    await runImportCommit(deps, job.data.batchId);
    log("import committed", { batchId: job.data.batchId });
  } catch (err) {
    await db
      .update(tables.importBatches)
      .set({ state: "commit_failed", error: String((err as Error).message).slice(0, 500) })
      .where(eq(tables.importBatches.id, job.data.batchId));
    throw err;
  }
});

await boss.work<ImportBatchJob>(QUEUES.importRollback, async (job) => {
  await runImportRollback(deps, job.data.batchId);
  log("import rolled back", { batchId: job.data.batchId });
});

await boss.work(QUEUES.stagingExpiry, async () => {
  const result = await expireStagingFiles(db, storage, (id) => log("staging delete failed", { id }));
  log("staging expiry", result);
});

await boss.schedule(QUEUES.refreshStale, "15 3 * * *", undefined, { tz: "Asia/Kolkata" });
await boss.schedule(QUEUES.stagingExpiry, "45 3 * * *", undefined, { tz: "Asia/Kolkata" });

log("worker started");

const shutdown = async () => {
  await boss.stop({ graceful: true });
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
