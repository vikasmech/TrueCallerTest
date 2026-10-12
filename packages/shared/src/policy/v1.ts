export const POLICY_VERSION = "v1" as const;

export const POLICY_V1 = {
  version: POLICY_VERSION,
  /** Reports older than this (by event_at) never contribute. */
  contributionWindowDays: 180,
  /** Recency weight halves every this many days. */
  halfLifeDays: 60,
  /** score = 100 * (1 - exp(-E / evidenceDivisor)) */
  evidenceDivisor: 6,
  scoreCap: 95,
  /** Distinct eligible reporters are counted over this window for public gates. */
  gateWindowDays: 90,
  /** Backdating beyond this many days is flagged for review (still accepted if within window). */
  backdateReviewDays: 180,
  reporterWeights: {
    new_verified: 0.25,
    established: 0.5,
    reviewed_valid_history: 1.0,
  },
  evidenceWeights: {
    none: 1.0,
    reviewed_corroboration: 1.25,
  },
  labelGates: {
    some: { minReporters: 3 },
    elevated: { minScore: 60, minReporters: 5 },
    strong: { minScore: 80, minReporters: 10 },
  },
} as const;

export type ReporterQualityTier = keyof typeof POLICY_V1.reporterWeights;
export type EvidenceTier = keyof typeof POLICY_V1.evidenceWeights;
