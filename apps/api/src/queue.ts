import PgBoss from "pg-boss";
import type pg from "pg";

export const QUEUES = {
  recomputeReputation: "recompute-reputation",
  refreshStale: "refresh-stale-reputations",
  importParse: "import-parse",
  importCommit: "import-commit",
  importRollback: "import-rollback",
  stagingExpiry: "staging-expiry",
} as const;

export type RecomputeJob = { phoneId: string };
export type ImportBatchJob = { batchId: string };

export function createBoss(connectionString: string): PgBoss {
  return new PgBoss({
    connectionString,
    schema: "pgboss",
    retryLimit: 5,
    retryDelay: 10,
    retryBackoff: true,
    archiveCompletedAfterSeconds: 3600,
    deleteAfterDays: 7,
  });
}

/** Adapter so pg-boss writes the job row through the caller's transaction client. */
export function txDb(client: pg.PoolClient | pg.Client): PgBoss.Db {
  return {
    async executeSql(text, values) {
      const r = await client.query(text, values);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
  };
}

export async function enqueueRecompute(
  boss: PgBoss,
  phoneId: string,
  opts: { db?: PgBoss.Db; delaySeconds?: number } = {},
): Promise<void> {
  await boss.send(
    QUEUES.recomputeReputation,
    { phoneId } satisfies RecomputeJob,
    {
      db: opts.db,
      // Collapses bursts of recompute requests for the same phone into one pending job.
      singletonKey: phoneId,
      singletonSeconds: 2,
      startAfter: opts.delaySeconds,
    },
  );
}
