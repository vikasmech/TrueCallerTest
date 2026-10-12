import { z } from "zod";
import {
  Category,
  Channel,
  DisputeDecision,
  DisputeReason,
  DisputeStatus,
  ImportBatchState,
  ImportMode,
  ImportRowStatus,
  PublicLabel,
  ReportDecision,
  ReportReasonCode,
  ReportStatus,
  Role,
  SourceReviewStatus,
  SupportBand,
} from "./enums.js";

export const PhoneInput = z.string().trim().min(3).max(32);

// ---- Auth ----
export const MagicLinkRequest = z.object({ email: z.string().email().max(254) });
export const MagicLinkVerifyQuery = z.object({ token: z.string().min(16).max(256) });
export const MeResponse = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: Role,
  verifiedContact: z.boolean(),
  consentedNoticeVersion: z.string().nullable(),
  restricted: z.boolean(),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const ConsentRequest = z.object({ noticeVersion: z.string().min(1).max(32) });

// ---- Reports ----
export const CreateReportRequest = z.object({
  idempotencyKey: z.string().min(8).max(128),
  phoneNumber: PhoneInput,
  channel: Channel,
  category: Category,
  eventAt: z.string().datetime({ offset: true }),
});
export type CreateReportRequest = z.infer<typeof CreateReportRequest>;

export const ReportSummary = z.object({
  id: z.string().uuid(),
  phoneNumberMasked: z.string(),
  channel: Channel,
  category: Category,
  eventAt: z.string(),
  submittedAt: z.string(),
  status: ReportStatus,
  withdrawnAt: z.string().nullable(),
});
export type ReportSummary = z.infer<typeof ReportSummary>;

export const CreateReportResponse = z.object({
  id: z.string().uuid(),
  status: ReportStatus,
  replayed: z.boolean(),
});
export type CreateReportResponse = z.infer<typeof CreateReportResponse>;

// ---- Lookup ----
export const LookupRequest = z.object({ phoneNumber: PhoneInput });

export const CategorySignal = z.object({
  score: z.number().int().min(0).max(100).nullable(),
  score_type: z.literal("community_report_strength").optional(),
  label: PublicLabel,
  support_band: SupportBand.optional(),
});

export const ExternalSignal = z.object({
  source_name: z.string(),
  category: Category,
  observed_at: z.string(),
  source_score: z.number().nullable(),
  source_score_scale: z.string().nullable(),
  expires_at: z.string().nullable(),
});

export const LookupResponse = z.object({
  identifier_type: z.literal("phone"),
  fraud: CategorySignal,
  spam: CategorySignal,
  external_signals: z.array(ExternalSignal),
  dispute_status: DisputeStatus,
  computed_at: z.string().nullable(),
  policy_version: z.string(),
  warning: z.string(),
});
export type LookupResponse = z.infer<typeof LookupResponse>;

export const LOOKUP_WARNING =
  "Based on user reports; not proof of fraud or caller identity. Reports relate to communications displaying this number and may not identify its current owner.";

// ---- Disputes ----
export const CreateDisputeRequest = z.object({
  phoneNumber: PhoneInput,
  reason: DisputeReason,
  details: z.string().max(2000).optional(),
});
export const DisputeSummary = z.object({
  id: z.string().uuid(),
  phoneNumberMasked: z.string(),
  reason: DisputeReason,
  details: z.string().nullable(),
  status: z.enum(["open", "resolved"]),
  decision: DisputeDecision.nullable(),
  createdAt: z.string(),
  decisionAt: z.string().nullable(),
});
export type DisputeSummary = z.infer<typeof DisputeSummary>;

// ---- Moderation ----
export const ReportDecisionRequest = z.object({
  decision: ReportDecision,
  reasonCode: ReportReasonCode,
  newCategory: Category.optional(),
  note: z.string().max(1000).optional(),
});
export const DisputeDecisionRequest = z.object({
  decision: DisputeDecision,
  note: z.string().max(1000).optional(),
  /** For uphold_correction: report IDs to invalidate. */
  invalidateReportIds: z.array(z.string().uuid()).max(500).optional(),
});
export const AdminReportRow = z.object({
  id: z.string().uuid(),
  phoneNumberMasked: z.string(),
  reporterId: z.string().uuid(),
  reporterTier: z.string(),
  channel: Channel,
  category: Category,
  eventAt: z.string(),
  submittedAt: z.string(),
  status: ReportStatus,
  screeningReason: z.string().nullable(),
  coordinationHold: z.boolean(),
});
export type AdminReportRow = z.infer<typeof AdminReportRow>;

// ---- Data sources ----
export const CreateDataSourceRequest = z.object({
  provider: z.string().min(1).max(200),
  provenanceGroupId: z.string().min(1).max(100),
  upstreamProvenance: z.string().max(2000).optional(),
  acquiredAt: z.string().datetime({ offset: true }).optional(),
  permittedUse: z.string().min(1).max(2000),
  permissionReference: z.string().min(1).max(500),
  displayAllowed: z.boolean(),
  validUntil: z.string().datetime({ offset: true }).nullable().optional(),
});
export const ReviewDataSourceRequest = z.object({
  status: z.enum(["approved", "rejected"]),
  note: z.string().max(1000).optional(),
});
export const DataSourceRow = z.object({
  id: z.string().uuid(),
  provider: z.string(),
  provenanceGroupId: z.string(),
  permittedUse: z.string(),
  permissionReference: z.string(),
  displayAllowed: z.boolean(),
  reviewStatus: SourceReviewStatus,
  validUntil: z.string().nullable(),
  createdAt: z.string(),
});
export type DataSourceRow = z.infer<typeof DataSourceRow>;

// ---- Imports ----
export const IMPORT_LIMITS = { maxRows: 50_000, maxBytes: 20 * 1024 * 1024 } as const;
export const IMPORT_CSV_COLUMNS = [
  "phone_number",
  "category",
  "observed_at",
  "external_record_id",
  "source_score",
  "source_score_scale",
  "expires_at",
] as const;

export const ImportRowCounts = z.object({
  total: z.number().int(),
  valid: z.number().int(),
  invalid: z.number().int(),
  duplicate: z.number().int(),
  stale: z.number().int(),
  excluded: z.number().int(),
  newNumbers: z.number().int(),
  existingNumbers: z.number().int(),
  newObservations: z.number().int(),
  duplicateObservations: z.number().int(),
  processed: z.number().int(),
});
export type ImportRowCounts = z.infer<typeof ImportRowCounts>;

export const ImportBatchRow = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  sourceProvider: z.string(),
  sourceReviewStatus: SourceReviewStatus,
  mode: ImportMode,
  state: ImportBatchState,
  uploaderId: z.string().uuid(),
  reviewerId: z.string().uuid().nullable(),
  fileChecksum: z.string(),
  idempotencyKey: z.string(),
  rowCounts: ImportRowCounts,
  error: z.string().nullable(),
  publishable: z.boolean(),
  createdAt: z.string(),
  committedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type ImportBatchRow = z.infer<typeof ImportBatchRow>;

export const ImportRowErrorRow = z.object({
  rowNumber: z.number().int(),
  status: ImportRowStatus,
  errorCode: z.string().nullable(),
});
