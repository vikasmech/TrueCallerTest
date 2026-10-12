CREATE TYPE "public"."category" AS ENUM('fraud', 'spam');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('call', 'sms');--> statement-breakpoint
CREATE TYPE "public"."dispute_decision" AS ENUM('reject', 'uphold_correction', 'uphold_reassignment');--> statement-breakpoint
CREATE TYPE "public"."dispute_reason" AS ENUM('not_me', 'number_reassigned', 'false_reports', 'other');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."import_batch_state" AS ENUM('staged', 'parsing', 'previewed', 'parse_failed', 'committing', 'committed', 'commit_failed', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."import_mode" AS ENUM('number_only', 'source_observation', 'synthetic_test');--> statement-breakpoint
CREATE TYPE "public"."import_row_status" AS ENUM('valid', 'invalid', 'duplicate', 'stale', 'excluded');--> statement-breakpoint
CREATE TYPE "public"."observation_status" AS ENUM('active', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."public_label" AS ENUM('insufficient_reports', 'some_suspicious_reports', 'elevated_community_risk_signal', 'strong_community_risk_signal');--> statement-breakpoint
CREATE TYPE "public"."quality_tier" AS ENUM('new_verified', 'established', 'reviewed_valid_history');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('accepted', 'in_review', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('user', 'moderator', 'admin');--> statement-breakpoint
CREATE TYPE "public"."source_review_status" AS ENUM('pending', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"notice_version" text NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "data_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provenance_group_id" text NOT NULL,
	"upstream_provenance" text,
	"acquired_at" timestamp with time zone,
	"permitted_use" text NOT NULL,
	"permission_reference" text NOT NULL,
	"display_allowed" boolean DEFAULT false NOT NULL,
	"review_status" "source_review_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_id" uuid NOT NULL,
	"claimant_id" uuid NOT NULL,
	"reason" "dispute_reason" NOT NULL,
	"details" text,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"decision" "dispute_decision",
	"decision_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"uploader_id" uuid NOT NULL,
	"reviewer_id" uuid,
	"mode" "import_mode" NOT NULL,
	"file_checksum" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"object_key" text NOT NULL,
	"file_size_bytes" integer NOT NULL,
	"state" "import_batch_state" DEFAULT 'staged' NOT NULL,
	"row_counts" jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"staging_expires_at" timestamp with time zone NOT NULL,
	"staging_deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_rows" (
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"validation_status" "import_row_status" NOT NULL,
	"error_code" text,
	"e164_encrypted" text,
	"lookup_key" text,
	"category" "category",
	"observed_at" timestamp with time zone,
	"external_record_id" text,
	"source_score" numeric(12, 4),
	"source_score_scale" text,
	"expires_at" timestamp with time zone,
	"fingerprint" text,
	"observation_id" uuid,
	"phone_id" uuid,
	CONSTRAINT "import_rows_batch_id_row_number_pk" PRIMARY KEY("batch_id","row_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "magic_link_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "moderation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"action" text NOT NULL,
	"reason_code" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "observation_batch_links" (
	"observation_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "observation_batch_links_observation_id_batch_id_pk" PRIMARY KEY("observation_id","batch_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "phone_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lookup_key" text NOT NULL,
	"encrypted_e164" text NOT NULL,
	"key_version" integer NOT NULL,
	"reputation_epoch" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reporter_quality" (
	"reporter_id" uuid PRIMARY KEY NOT NULL,
	"quality_tier" "quality_tier" DEFAULT 'new_verified' NOT NULL,
	"reviewed_valid_count" integer DEFAULT 0 NOT NULL,
	"reviewed_invalid_count" integer DEFAULT 0 NOT NULL,
	"policy_version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_id" uuid NOT NULL,
	"reporter_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"channel" "channel" NOT NULL,
	"category" "category" NOT NULL,
	"event_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "report_status" NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"screening_reason" text,
	"coordination_hold" boolean DEFAULT false NOT NULL,
	"reputation_epoch" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reputations" (
	"phone_id" uuid NOT NULL,
	"category" "category" NOT NULL,
	"score" integer,
	"eligible_reporter_count" integer DEFAULT 0 NOT NULL,
	"recent_eligible_reporter_count" integer DEFAULT 0 NOT NULL,
	"effective_evidence" numeric(12, 6) DEFAULT '0' NOT NULL,
	"public_label" "public_label" DEFAULT 'insufficient_reports' NOT NULL,
	"coordination_hold" boolean DEFAULT false NOT NULL,
	"last_report_at" timestamp with time zone,
	"computed_at" timestamp with time zone NOT NULL,
	"next_refresh_at" timestamp with time zone NOT NULL,
	"policy_version" text NOT NULL,
	CONSTRAINT "reputations_phone_id_category_pk" PRIMARY KEY("phone_id","category")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "source_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"provenance_group_id" text NOT NULL,
	"external_record_id" text,
	"category" "category" NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"source_score" numeric(12, 4),
	"source_score_scale" text,
	"expires_at" timestamp with time zone,
	"status" "observation_status" DEFAULT 'active' NOT NULL,
	"reputation_epoch" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role" "role" DEFAULT 'user' NOT NULL,
	"verified_contact" boolean DEFAULT false NOT NULL,
	"restricted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "disputes" ADD CONSTRAINT "disputes_phone_id_phone_numbers_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phone_numbers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "disputes" ADD CONSTRAINT "disputes_claimant_id_users_id_fk" FOREIGN KEY ("claimant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "observation_batch_links" ADD CONSTRAINT "observation_batch_links_observation_id_source_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."source_observations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "observation_batch_links" ADD CONSTRAINT "observation_batch_links_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reporter_quality" ADD CONSTRAINT "reporter_quality_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reports" ADD CONSTRAINT "reports_phone_id_phone_numbers_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phone_numbers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reputations" ADD CONSTRAINT "reputations_phone_id_phone_numbers_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phone_numbers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "source_observations" ADD CONSTRAINT "source_observations_phone_id_phone_numbers_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phone_numbers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "source_observations" ADD CONSTRAINT "source_observations_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_events_user_idx" ON "consent_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "disputes_phone_status_idx" ON "disputes" USING btree ("phone_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "import_batches_source_idem_uq" ON "import_batches" USING btree ("source_id","idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_rows_batch_status_idx" ON "import_rows" USING btree ("batch_id","validation_status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "magic_link_tokens_hash_uq" ON "magic_link_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "moderation_actions_target_idx" ON "moderation_actions" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "observation_batch_links_batch_idx" ON "observation_batch_links" USING btree ("batch_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "phone_numbers_lookup_key_uq" ON "phone_numbers" USING btree ("lookup_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reports_reporter_idem_uq" ON "reports" USING btree ("reporter_id","idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reports_phone_cat_status_event_idx" ON "reports" USING btree ("phone_id","category","status","event_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reports_reporter_submitted_idx" ON "reports" USING btree ("reporter_id","submitted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reputations_next_refresh_idx" ON "reputations" USING btree ("next_refresh_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "source_observations_fingerprint_uq" ON "source_observations" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_observations_phone_status_idx" ON "source_observations" USING btree ("phone_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_uq" ON "users" USING btree ("email");