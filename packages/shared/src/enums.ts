import { z } from "zod";

export const Channel = z.enum(["call", "sms"]);
export type Channel = z.infer<typeof Channel>;

export const Category = z.enum(["fraud", "spam"]);
export type Category = z.infer<typeof Category>;
export const CATEGORIES: readonly Category[] = ["fraud", "spam"];

export const ReportStatus = z.enum(["accepted", "in_review", "rejected", "withdrawn"]);
export type ReportStatus = z.infer<typeof ReportStatus>;

export const PublicLabel = z.enum([
  "insufficient_reports",
  "some_suspicious_reports",
  "elevated_community_risk_signal",
  "strong_community_risk_signal",
]);
export type PublicLabel = z.infer<typeof PublicLabel>;

export const SupportBand = z.enum([
  "fewer_than_3_recent_eligible_reporters",
  "3_to_4_recent_eligible_reporters",
  "5_to_9_recent_eligible_reporters",
  "10_or_more_recent_eligible_reporters",
]);
export type SupportBand = z.infer<typeof SupportBand>;

export const DisputeStatus = z.enum(["none", "open", "resolved"]);
export type DisputeStatus = z.infer<typeof DisputeStatus>;

export const DisputeReason = z.enum(["not_me", "number_reassigned", "false_reports", "other"]);
export type DisputeReason = z.infer<typeof DisputeReason>;

export const DisputeDecision = z.enum(["reject", "uphold_correction", "uphold_reassignment"]);
export type DisputeDecision = z.infer<typeof DisputeDecision>;

export const ReportDecision = z.enum(["accept", "reject", "recategorize", "hold"]);
export type ReportDecision = z.infer<typeof ReportDecision>;

export const ReportReasonCode = z.enum([
  "verified_incident",
  "insufficient_detail",
  "duplicate",
  "wrong_category",
  "suspected_coordination",
  "demonstrably_false",
  "needs_review",
]);
export type ReportReasonCode = z.infer<typeof ReportReasonCode>;

export const Role = z.enum(["user", "moderator", "admin"]);
export type Role = z.infer<typeof Role>;

export const SourceReviewStatus = z.enum(["pending", "approved", "rejected", "expired"]);
export type SourceReviewStatus = z.infer<typeof SourceReviewStatus>;

export const ImportMode = z.enum(["number_only", "source_observation", "synthetic_test"]);
export type ImportMode = z.infer<typeof ImportMode>;

export const ImportBatchState = z.enum([
  "staged",
  "parsing",
  "previewed",
  "parse_failed",
  "committing",
  "committed",
  "commit_failed",
  "revoked",
]);
export type ImportBatchState = z.infer<typeof ImportBatchState>;

export const ImportRowStatus = z.enum(["valid", "invalid", "duplicate", "stale", "excluded"]);
export type ImportRowStatus = z.infer<typeof ImportRowStatus>;

export const ObservationStatus = z.enum(["active", "revoked", "expired"]);
export type ObservationStatus = z.infer<typeof ObservationStatus>;
