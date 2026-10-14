import { eq, sql } from "drizzle-orm";
import type PgBoss from "pg-boss";
import type pg from "pg";
import { POLICY_VERSION, type ReporterQualityTier } from "@phone-rep/shared";
import type { Db } from "../db/client.js";
import { reporterQuality, reports } from "../db/schema.js";
import { enqueueRecompute, txDb } from "../queue.js";

export function qualityTier(valid: number, invalid: number): ReporterQualityTier {
  if (invalid > 0) return "new_verified";
  if (valid >= 5) return "reviewed_valid_history";
  return valid >= 1 ? "established" : "new_verified";
}

/**
 * Call inside the moderation transaction after recording the report's outcome.
 * The reporter row lock serializes reviews of different reports by the same person.
 * Aggregate distinct report rows rather than incrementing a counter per HTTP request.
 */
export async function refreshReporterQuality(
  tx: Db,
  reporterId: string,
  boss: PgBoss,
  client: pg.PoolClient,
): Promise<void> {
  await tx.insert(reporterQuality).values({ reporterId, policyVersion: POLICY_VERSION }).onConflictDoNothing();
  const [previous] = await tx.select().from(reporterQuality)
    .where(eq(reporterQuality.reporterId, reporterId)).for("update");
  const [counts] = await tx.select({
    valid: sql<number>`count(*) filter (where ${reports.reviewedOutcome} = 'valid')::int`,
    invalid: sql<number>`count(*) filter (where ${reports.reviewedOutcome} = 'invalid')::int`,
  }).from(reports).where(eq(reports.reporterId, reporterId));
  const valid = counts?.valid ?? 0;
  const invalid = counts?.invalid ?? 0;
  const tier = qualityTier(valid, invalid);
  await tx.update(reporterQuality).set({
    reviewedValidCount: valid,
    reviewedInvalidCount: invalid,
    qualityTier: tier,
    policyVersion: POLICY_VERSION,
    updatedAt: new Date(),
  }).where(eq(reporterQuality.reporterId, reporterId));

  if (tier !== previous?.qualityTier) {
    // Changing trust changes the weights of this reporter's OTHER numbers too.
    const affected = await tx.selectDistinct({ phoneId: reports.phoneId })
      .from(reports).where(eq(reports.reporterId, reporterId));
    for (const { phoneId } of affected) await enqueueRecompute(boss, phoneId, { db: txDb(client) });
  }
}
