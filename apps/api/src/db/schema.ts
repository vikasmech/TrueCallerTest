import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["user", "moderator", "admin"]);
export const channelEnum = pgEnum("channel", ["call", "sms"]);
export const categoryEnum = pgEnum("category", ["fraud", "spam"]);
export const reportStatusEnum = pgEnum("report_status", [
  "accepted",
  "in_review",
  "rejected",
  "withdrawn",
]);
export const qualityTierEnum = pgEnum("quality_tier", [
  "new_verified",
  "established",
  "reviewed_valid_history",
]);
export const publicLabelEnum = pgEnum("public_label", [
  "insufficient_reports",
  "some_suspicious_reports",
  "elevated_community_risk_signal",
  "strong_community_risk_signal",
]);
export const disputeStatusEnum = pgEnum("dispute_status", ["open", "resolved"]);
export const disputeReasonEnum = pgEnum("dispute_reason", [
  "not_me",
  "number_reassigned",
  "false_reports",
  "other",
]);
export const disputeDecisionEnum = pgEnum("dispute_decision", [
  "reject",
  "uphold_correction",
  "uphold_reassignment",
]);
export const sourceReviewStatusEnum = pgEnum("source_review_status", [
  "pending",
  "approved",
  "rejected",
  "expired",
]);
export const importModeEnum = pgEnum("import_mode", [
  "number_only",
  "source_observation",
  "synthetic_test",
]);
export const importBatchStateEnum = pgEnum("import_batch_state", [
  "staged",
  "parsing",
  "previewed",
  "parse_failed",
  "committing",
  "committed",
  "commit_failed",
  "revoked",
]);
export const importRowStatusEnum = pgEnum("import_row_status", [
  "valid",
  "invalid",
  "duplicate",
  "stale",
  "excluded",
]);
export const observationStatusEnum = pgEnum("observation_status", ["active", "revoked", "expired"]);

const now = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    role: roleEnum("role").notNull().default("user"),
    verifiedContact: boolean("verified_contact").notNull().default(false),
    restrictedAt: timestamp("restricted_at", { withTimezone: true }),
    createdAt: now(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const magicLinkTokens = pgTable(
  "magic_link_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    email: text("email").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: now(),
  },
  (t) => [uniqueIndex("magic_link_tokens_hash_uq").on(t.tokenHash)],
);

export const consentEvents = pgTable(
  "consent_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    noticeVersion: text("notice_version").notNull(),
    action: text("action").notNull(),
    createdAt: now(),
  },
  (t) => [index("consent_events_user_idx").on(t.userId, t.createdAt)],
);

export const phoneNumbers = pgTable(
  "phone_numbers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lookupKey: text("lookup_key").notNull(),
    encryptedE164: text("encrypted_e164").notNull(),
    keyVersion: integer("key_version").notNull(),
    reputationEpoch: integer("reputation_epoch").notNull().default(1),
    createdAt: now(),
  },
  (t) => [uniqueIndex("phone_numbers_lookup_key_uq").on(t.lookupKey)],
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phoneId: uuid("phone_id")
      .notNull()
      .references(() => phoneNumbers.id),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id),
    idempotencyKey: text("idempotency_key").notNull(),
    channel: channelEnum("channel").notNull(),
    category: categoryEnum("category").notNull(),
    eventAt: timestamp("event_at", { withTimezone: true }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    status: reportStatusEnum("status").notNull(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    screeningReason: text("screening_reason"),
    // One current human-reviewed outcome per report; repeated decisions cannot inflate trust.
    reviewedOutcome: text("reviewed_outcome").$type<"valid" | "invalid">(),
    coordinationHold: boolean("coordination_hold").notNull().default(false),
    reputationEpoch: integer("reputation_epoch").notNull(),
  },
  (t) => [
    uniqueIndex("reports_reporter_idem_uq").on(t.reporterId, t.idempotencyKey),
    index("reports_phone_cat_status_event_idx").on(t.phoneId, t.category, t.status, t.eventAt),
    index("reports_reporter_submitted_idx").on(t.reporterId, t.submittedAt),
  ],
);

export const reporterQuality = pgTable("reporter_quality", {
  reporterId: uuid("reporter_id")
    .primaryKey()
    .references(() => users.id),
  qualityTier: qualityTierEnum("quality_tier").notNull().default("new_verified"),
  reviewedValidCount: integer("reviewed_valid_count").notNull().default(0),
  reviewedInvalidCount: integer("reviewed_invalid_count").notNull().default(0),
  policyVersion: text("policy_version").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reputations = pgTable(
  "reputations",
  {
    phoneId: uuid("phone_id")
      .notNull()
      .references(() => phoneNumbers.id),
    category: categoryEnum("category").notNull(),
    score: integer("score"),
    eligibleReporterCount: integer("eligible_reporter_count").notNull().default(0),
    recentEligibleReporterCount: integer("recent_eligible_reporter_count").notNull().default(0),
    effectiveEvidence: numeric("effective_evidence", { precision: 12, scale: 6 })
      .notNull()
      .default("0"),
    publicLabel: publicLabelEnum("public_label").notNull().default("insufficient_reports"),
    coordinationHold: boolean("coordination_hold").notNull().default(false),
    lastReportAt: timestamp("last_report_at", { withTimezone: true }),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
    nextRefreshAt: timestamp("next_refresh_at", { withTimezone: true }).notNull(),
    policyVersion: text("policy_version").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.phoneId, t.category] }),
    index("reputations_next_refresh_idx").on(t.nextRefreshAt),
  ],
);

export const disputes = pgTable(
  "disputes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phoneId: uuid("phone_id")
      .notNull()
      .references(() => phoneNumbers.id),
    claimantId: uuid("claimant_id")
      .notNull()
      .references(() => users.id),
    reason: disputeReasonEnum("reason").notNull(),
    details: text("details"),
    status: disputeStatusEnum("status").notNull().default("open"),
    decision: disputeDecisionEnum("decision"),
    decisionAt: timestamp("decision_at", { withTimezone: true }),
    createdAt: now(),
  },
  (t) => [index("disputes_phone_status_idx").on(t.phoneId, t.status)],
);

export const moderationActions = pgTable(
  "moderation_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    action: text("action").notNull(),
    reasonCode: text("reason_code"),
    note: text("note"),
    createdAt: now(),
  },
  (t) => [index("moderation_actions_target_idx").on(t.targetType, t.targetId)],
);

export const dataSources = pgTable("data_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  provenanceGroupId: text("provenance_group_id").notNull(),
  upstreamProvenance: text("upstream_provenance"),
  acquiredAt: timestamp("acquired_at", { withTimezone: true }),
  permittedUse: text("permitted_use").notNull(),
  permissionReference: text("permission_reference").notNull(),
  displayAllowed: boolean("display_allowed").notNull().default(false),
  reviewStatus: sourceReviewStatusEnum("review_status").notNull().default("pending"),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: now(),
});

export type ImportRowCountsJson = {
  total: number;
  valid: number;
  invalid: number;
  duplicate: number;
  stale: number;
  excluded: number;
  newNumbers: number;
  existingNumbers: number;
  newObservations: number;
  duplicateObservations: number;
  processed: number;
};

export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => dataSources.id),
    uploaderId: uuid("uploader_id")
      .notNull()
      .references(() => users.id),
    reviewerId: uuid("reviewer_id").references(() => users.id),
    mode: importModeEnum("mode").notNull(),
    fileChecksum: text("file_checksum").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    objectKey: text("object_key").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    state: importBatchStateEnum("state").notNull().default("staged"),
    rowCounts: jsonb("row_counts").$type<ImportRowCountsJson>().notNull(),
    error: text("error"),
    createdAt: now(),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    stagingExpiresAt: timestamp("staging_expires_at", { withTimezone: true }).notNull(),
    stagingDeletedAt: timestamp("staging_deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("import_batches_source_idem_uq").on(t.sourceId, t.idempotencyKey)],
);

export const importRows = pgTable(
  "import_rows",
  {
    batchId: uuid("batch_id")
      .notNull()
      .references(() => importBatches.id),
    rowNumber: integer("row_number").notNull(),
    validationStatus: importRowStatusEnum("validation_status").notNull(),
    errorCode: text("error_code"),
    // Normalized payload kept for commit; raw CSV cells are not retained.
    e164Encrypted: text("e164_encrypted"),
    lookupKey: text("lookup_key"),
    category: categoryEnum("category"),
    observedAt: timestamp("observed_at", { withTimezone: true }),
    externalRecordId: text("external_record_id"),
    sourceScore: numeric("source_score", { precision: 12, scale: 4 }),
    sourceScoreScale: text("source_score_scale"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    fingerprint: text("fingerprint"),
    observationId: uuid("observation_id"),
    phoneId: uuid("phone_id"),
  },
  (t) => [
    primaryKey({ columns: [t.batchId, t.rowNumber] }),
    index("import_rows_batch_status_idx").on(t.batchId, t.validationStatus),
  ],
);

export const sourceObservations = pgTable(
  "source_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phoneId: uuid("phone_id")
      .notNull()
      .references(() => phoneNumbers.id),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => dataSources.id),
    provenanceGroupId: text("provenance_group_id").notNull(),
    externalRecordId: text("external_record_id"),
    category: categoryEnum("category").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    sourceScore: numeric("source_score", { precision: 12, scale: 4 }),
    sourceScoreScale: text("source_score_scale"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: observationStatusEnum("status").notNull().default("active"),
    reputationEpoch: integer("reputation_epoch").notNull(),
    fingerprint: text("fingerprint").notNull(),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex("source_observations_fingerprint_uq").on(t.fingerprint),
    index("source_observations_phone_status_idx").on(t.phoneId, t.status),
  ],
);

export const observationBatchLinks = pgTable(
  "observation_batch_links",
  {
    observationId: uuid("observation_id")
      .notNull()
      .references(() => sourceObservations.id),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => importBatches.id),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    primaryKey({ columns: [t.observationId, t.batchId] }),
    index("observation_batch_links_batch_idx").on(t.batchId, t.active),
  ],
);

export const schema = {
  users,
  magicLinkTokens,
  consentEvents,
  phoneNumbers,
  reports,
  reporterQuality,
  reputations,
  disputes,
  moderationActions,
  dataSources,
  importBatches,
  importRows,
  sourceObservations,
  observationBatchLinks,
};

export const nowSql = sql`now()`;
