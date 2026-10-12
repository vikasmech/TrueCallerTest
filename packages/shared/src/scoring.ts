import { POLICY_V1, type EvidenceTier, type ReporterQualityTier } from "./policy/v1.js";
import type { Category, PublicLabel, SupportBand } from "./enums.js";

const DAY_MS = 86_400_000;

/** A report as seen by the scorer: already filtered to non-withdrawn rows for one phone. */
export type ScorableReport = {
  reporterId: string;
  category: Category;
  status: "accepted" | "in_review" | "rejected" | "withdrawn";
  /** Validated communication timestamp. */
  eventAt: Date;
  reputationEpoch: number;
  evidenceTier?: EvidenceTier;
  /** Set when a moderator has flagged this report as part of suspected coordination. */
  coordinationHold?: boolean;
};

export type ReporterQualityMap = Record<string, ReporterQualityTier | undefined>;

export type Contribution = {
  reporterId: string;
  weight: number;
  ageDays: number;
};

export type CategoryResult = {
  category: Category;
  /** Internal 0–95 score; null when there are no eligible contributions. */
  score: number | null;
  effectiveEvidence: number;
  eligibleReporterCount: number;
  recentEligibleReporterCount: number;
  publicLabel: PublicLabel;
  supportBand: SupportBand;
  coordinationHold: boolean;
  lastReportAt: Date | null;
};

export function recencyWeight(ageDays: number, halfLifeDays = POLICY_V1.halfLifeDays): number {
  if (ageDays < 0) return 1;
  return Math.pow(2, -ageDays / halfLifeDays);
}

export function reporterWeight(tier: ReporterQualityTier | undefined): number {
  return POLICY_V1.reporterWeights[tier ?? "new_verified"];
}

export function evidenceWeight(tier: EvidenceTier | undefined): number {
  return POLICY_V1.evidenceWeights[tier ?? "none"];
}

export function computeScore(effectiveEvidence: number): number | null {
  if (effectiveEvidence <= 0) return null;
  const raw = Math.round(100 * (1 - Math.exp(-effectiveEvidence / POLICY_V1.evidenceDivisor)));
  return Math.min(POLICY_V1.scoreCap, raw);
}

export function supportBand(recentReporters: number): SupportBand {
  if (recentReporters >= 10) return "10_or_more_recent_eligible_reporters";
  if (recentReporters >= 5) return "5_to_9_recent_eligible_reporters";
  if (recentReporters >= 3) return "3_to_4_recent_eligible_reporters";
  return "fewer_than_3_recent_eligible_reporters";
}

/** Returns the highest label whose score AND reporter gate are both satisfied. */
export function publicLabel(
  score: number | null,
  recentReporters: number,
  coordinationHold: boolean,
): PublicLabel {
  const g = POLICY_V1.labelGates;
  if (score === null || recentReporters < g.some.minReporters) return "insufficient_reports";
  if (score >= g.strong.minScore && recentReporters >= g.strong.minReporters && !coordinationHold) {
    return "strong_community_risk_signal";
  }
  if (score >= g.elevated.minScore && recentReporters >= g.elevated.minReporters) {
    return "elevated_community_risk_signal";
  }
  return "some_suspicious_reports";
}

/**
 * Picks at most one contribution per reporter for a category: accepted, within the current
 * epoch and window, strongest by weight. Coordination-held reports are excluded from E but
 * raise the hold flag.
 */
export function selectContributions(
  reports: readonly ScorableReport[],
  quality: ReporterQualityMap,
  category: Category,
  currentEpoch: number,
  now: Date,
): { contributions: Contribution[]; coordinationHold: boolean; lastReportAt: Date | null } {
  const best = new Map<string, Contribution>();
  let coordinationHold = false;
  let lastReportAt: Date | null = null;

  for (const r of reports) {
    if (r.category !== category) continue;
    if (r.reputationEpoch !== currentEpoch) continue;
    if (r.eventAt.getTime() > now.getTime()) continue;
    const ageDays = (now.getTime() - r.eventAt.getTime()) / DAY_MS;
    if (ageDays > POLICY_V1.contributionWindowDays) continue;
    if (r.coordinationHold) {
      coordinationHold = true;
      continue;
    }
    if (r.status !== "accepted") continue;

    if (!lastReportAt || r.eventAt > lastReportAt) lastReportAt = r.eventAt;

    const weight =
      reporterWeight(quality[r.reporterId]) *
      evidenceWeight(r.evidenceTier) *
      recencyWeight(ageDays);
    const existing = best.get(r.reporterId);
    if (!existing || weight > existing.weight) {
      best.set(r.reporterId, { reporterId: r.reporterId, weight, ageDays });
    }
  }
  return { contributions: [...best.values()], coordinationHold, lastReportAt };
}

export function scoreCategory(
  reports: readonly ScorableReport[],
  quality: ReporterQualityMap,
  category: Category,
  currentEpoch: number,
  now: Date,
): CategoryResult {
  const { contributions, coordinationHold, lastReportAt } = selectContributions(
    reports,
    quality,
    category,
    currentEpoch,
    now,
  );
  const E = contributions.reduce((sum, c) => sum + c.weight, 0);
  const score = computeScore(E);
  const recent = contributions.filter((c) => c.ageDays <= POLICY_V1.gateWindowDays).length;
  return {
    category,
    score,
    effectiveEvidence: E,
    eligibleReporterCount: contributions.length,
    recentEligibleReporterCount: recent,
    publicLabel: publicLabel(score, recent, coordinationHold),
    supportBand: supportBand(recent),
    coordinationHold,
    lastReportAt,
  };
}

/** Earliest time any contribution's decay materially changes; used to schedule refreshes. */
export function nextRefreshAt(now: Date): Date {
  return new Date(now.getTime() + DAY_MS);
}
