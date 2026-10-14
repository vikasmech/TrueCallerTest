ALTER TABLE "reports" ADD COLUMN "reviewed_outcome" text;
--> statement-breakpoint
-- Recover one current reviewed outcome per report, not one count per audit entry.
UPDATE reports r SET reviewed_outcome = 'valid'
WHERE r.status = 'accepted' AND EXISTS (
  SELECT 1 FROM moderation_actions m
  WHERE m.target_type = 'report' AND m.target_id = r.id
    AND m.action IN ('accept', 'recategorize')
);
--> statement-breakpoint
UPDATE reports SET reviewed_outcome = 'invalid'
WHERE status = 'rejected' AND screening_reason = 'demonstrably_false';
--> statement-breakpoint
UPDATE reporter_quality q SET
  reviewed_valid_count = c.valid,
  reviewed_invalid_count = c.invalid,
  quality_tier = (CASE
    WHEN c.invalid > 0 THEN 'new_verified'
    WHEN c.valid >= 5 THEN 'reviewed_valid_history'
    WHEN c.valid >= 1 THEN 'established'
    ELSE 'new_verified'
  END)::quality_tier,
  updated_at = now()
FROM (
  SELECT u.id,
    count(r.id) FILTER (WHERE r.reviewed_outcome = 'valid')::int AS valid,
    count(r.id) FILTER (WHERE r.reviewed_outcome = 'invalid')::int AS invalid
  FROM users u LEFT JOIN reports r ON r.reporter_id = u.id
  GROUP BY u.id
) c WHERE q.reporter_id = c.id;
--> statement-breakpoint
-- Do not serve previously inflated summaries while waiting for the scheduled refresh.
UPDATE reputations SET score = NULL, public_label = 'insufficient_reports', next_refresh_at = now();