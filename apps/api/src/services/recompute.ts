import { and, eq, inArray, lte, ne, sql } from "drizzle-orm";
import {
  CATEGORIES,
  POLICY_VERSION,
  nextRefreshAt,
  scoreCategory,
  type ReporterQualityMap,
  type ScorableReport,
} from "@phone-rep/shared";
import type { Db } from "../db/client.js";
import { phoneNumbers, reporterQuality, reports, reputations, sourceObservations } from "../db/schema.js";

/** Recomputes every category summary for one phone from accepted reports; idempotent. */
export async function recomputeReputation(db: Db, phoneId: string, now = new Date()): Promise<void> {
  const [phone] = await db.select().from(phoneNumbers).where(eq(phoneNumbers.id, phoneId)).limit(1);
  if (!phone) return;

  const rows = await db
    .select({
      reporterId: reports.reporterId,
      category: reports.category,
      status: reports.status,
      eventAt: reports.eventAt,
      reputationEpoch: reports.reputationEpoch,
      coordinationHold: reports.coordinationHold,
    })
    .from(reports)
    .where(and(eq(reports.phoneId, phoneId), ne(reports.status, "withdrawn")));

  const reporterIds = [...new Set(rows.map((r) => r.reporterId))];
  const quality: ReporterQualityMap = {};
  if (reporterIds.length) {
    const q = await db
      .select({ id: reporterQuality.reporterId, tier: reporterQuality.qualityTier })
      .from(reporterQuality)
      .where(inArray(reporterQuality.reporterId, reporterIds));
    for (const row of q) quality[row.id] = row.tier;
  }

  const scorable: ScorableReport[] = rows.map((r) => ({ ...r, evidenceTier: "none" }));

  for (const category of CATEGORIES) {
    const result = scoreCategory(scorable, quality, category, phone.reputationEpoch, now);
    await db
      .insert(reputations)
      .values({
        phoneId,
        category,
        score: result.score,
        eligibleReporterCount: result.eligibleReporterCount,
        recentEligibleReporterCount: result.recentEligibleReporterCount,
        effectiveEvidence: result.effectiveEvidence.toFixed(6),
        publicLabel: result.publicLabel,
        coordinationHold: result.coordinationHold,
        lastReportAt: result.lastReportAt,
        computedAt: now,
        nextRefreshAt: nextRefreshAt(now),
        policyVersion: POLICY_VERSION,
      })
      .onConflictDoUpdate({
        target: [reputations.phoneId, reputations.category],
        set: {
          score: sql`excluded.score`,
          eligibleReporterCount: sql`excluded.eligible_reporter_count`,
          recentEligibleReporterCount: sql`excluded.recent_eligible_reporter_count`,
          effectiveEvidence: sql`excluded.effective_evidence`,
          publicLabel: sql`excluded.public_label`,
          coordinationHold: sql`excluded.coordination_hold`,
          lastReportAt: sql`excluded.last_report_at`,
          computedAt: sql`excluded.computed_at`,
          nextRefreshAt: sql`excluded.next_refresh_at`,
          policyVersion: sql`excluded.policy_version`,
        },
      });
  }

  // External observations past their own expiry stop being displayable.
  await db
    .update(sourceObservations)
    .set({ status: "expired" })
    .where(
      and(
        eq(sourceObservations.phoneId, phoneId),
        eq(sourceObservations.status, "active"),
        lte(sourceObservations.expiresAt, now),
      ),
    );
}

export async function stalePhoneIds(db: Db, now = new Date(), limit = 1000): Promise<string[]> {
  const rows = await db
    .selectDistinct({ phoneId: reputations.phoneId })
    .from(reputations)
    .where(lte(reputations.nextRefreshAt, now))
    .limit(limit);
  return rows.map((r) => r.phoneId);
}
