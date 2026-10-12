import { and, count, eq, gt, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { reports, users } from "../db/schema.js";

export type ScreeningOutcome = {
  status: "accepted" | "in_review";
  reason: string | null;
  coordinationHold: boolean;
};

const HOUR_MS = 3_600_000;

/**
 * Conservative heuristics only. Shared network signals are deliberately not used here;
 * anything suspicious is held for a human rather than rejected or trusted automatically.
 */
export async function screenReport(
  db: Db,
  input: { reporterId: string; phoneId: string; eventAt: Date; now: Date; backdateReviewDays: number },
): Promise<ScreeningOutcome> {
  const { reporterId, phoneId, eventAt, now } = input;

  const ageDays = (now.getTime() - eventAt.getTime()) / 86_400_000;
  if (ageDays > input.backdateReviewDays) {
    return { status: "in_review", reason: "backdated_beyond_window", coordinationHold: false };
  }

  const dayAgo = new Date(now.getTime() - 24 * HOUR_MS);
  const [mine] = await db
    .select({ n: count() })
    .from(reports)
    .where(and(eq(reports.reporterId, reporterId), gt(reports.submittedAt, dayAgo)));
  if ((mine?.n ?? 0) >= 20) {
    return { status: "in_review", reason: "reporter_daily_burst", coordinationHold: false };
  }

  // Many reports on one number within an hour from accounts created in the last 7 days.
  const hourAgo = new Date(now.getTime() - HOUR_MS);
  const weekAgo = new Date(now.getTime() - 7 * 24 * HOUR_MS);
  const [burst] = await db
    .select({ n: sql<number>`count(distinct ${reports.reporterId})` })
    .from(reports)
    .innerJoin(users, eq(users.id, reports.reporterId))
    .where(
      and(
        eq(reports.phoneId, phoneId),
        gt(reports.submittedAt, hourAgo),
        gt(users.createdAt, weekAgo),
        ne(reports.status, "withdrawn"),
      ),
    );
  if (Number(burst?.n ?? 0) >= 5) {
    return { status: "in_review", reason: "new_account_burst", coordinationHold: true };
  }

  return { status: "accepted", reason: null, coordinationHold: false };
}
