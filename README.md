# India Phone Reputation — Private Pilot

Implementation of delivery step 1 ("Private pilot") from
[india-phone-reputation-system-design.md](india-phone-reputation-system-design.md):
authenticated manual reporting, exact-number lookup, separate fraud/spam community scores,
moderation, withdrawals, disputes, and administrator CSV imports with a source registry,
preview, approval, deduplication and rollback. Evidence uploads (step 2) are not included.

## Layout

| Path | Purpose |
|---|---|
| `packages/shared` | Policy constants (v1), phone normalization, pure scoring, zod API contracts |
| `apps/api` | Fastify API, Drizzle schema + migrations, services shared with the worker |
| `apps/worker` | pg-boss worker: reputation recompute, daily refresh, import parse/commit/rollback, staging expiry |
| `apps/web` | Next.js app: sign-in, consent, report, lookup, my reports, disputes, moderation, admin sources/imports |
| `docker-compose.yml` | PostgreSQL 16 and MinIO (private import staging) |

## Prerequisites

- Node 22.12+ (22 LTS or 24 LTS) and pnpm 9 (`npm i -g pnpm`)
- Either Docker with Compose (Postgres + MinIO), or no Docker: use `pnpm dev:db` (embedded
  Postgres on port 5433) and leave `S3_ENDPOINT` empty so import staging uses a local directory.

## Run locally

```bash
cp .env.example .env            # then set SESSION_SECRET / PHONE_* keys: openssl rand -hex 32
pnpm install

# Option A: Docker
docker compose up -d

# Option B: no Docker (separate terminal; keep it running)
pnpm dev:db                     # then in .env: DATABASE_URL=...@localhost:5433/phonerep and S3_ENDPOINT=

pnpm --filter @phone-rep/shared build
pnpm --filter @phone-rep/api build
pnpm db:migrate
pnpm db:seed                    # optional synthetic data (refuses in production)

# three terminals
pnpm dev:api                    # http://localhost:4000
pnpm dev:worker
pnpm dev:web                    # http://localhost:3000 (proxies /api/* to the API)
```

`pnpm smoke` runs an end-to-end curl script against a running API + worker (sign-in, lookup,
report, idempotent replay, withdraw, dispute → epoch bump, data source → import preview →
commit → rollback).

Sign in with magic links: the link is printed to the API console (`MAILER=console`).
This mode is development-only. Production requires `MAILER=smtp`, the `SMTP_*` secrets
in `.env.example`, and an HTTPS `WEB_BASE_URL`. SMTP requires TLS (implicit TLS with
`SMTP_SECURE=true`, or STARTTLS otherwise); it never logs sign-in links. API access logs
omit URL query strings, and the verification page/API disable referrers and caching.
Set reverse-proxy/CDN access logs to omit query strings for `/auth/verify` and
`/api/v1/auth/verify` too; application logging cannot control infrastructure logs.

`ADMIN_EMAILS` / `MODERATOR_EMAILS` are authoritative allowlists checked on every
authenticated API request, including existing sessions. Removing an email revokes its
privilege after configuration is reloaded/restarted on all API instances. Sign-in also
synchronizes the stored role downward. Restart every instance when changing allowlists.

Seeded lookups (after `pnpm db:seed`): `+919000000001` (strong fraud signal),
`+919000000002` (some suspicious reports), `+919000000003` (spam only).

## Tests

```bash
pnpm test        # vitest: scoring, normalization, crypto, CSV import parsing
pnpm typecheck
```

The database-backed security regressions require a **disposable local PostgreSQL**
account with `CREATEDB` permission:

```
TEST_DATABASE_URL=postgres://localhost/postgres pnpm --filter @phone-rep/api test
```

The suite creates and drops its own randomly named `phone_rep_test_*` database. It
does not truncate the database supplied in the URL. Without this variable, those
integration tests are explicitly skipped. SMTP delivery tests use a mock transport;
verify actual delivery with your provider before opening the pilot.

## Key behaviours

- One transaction inserts a report and its `recompute-reputation` job (pg-boss `send` with the
  transaction client). The worker recalculates from accepted reports; nothing increments counters.
- Phone numbers are stored as HMAC lookup keys plus AES-256-GCM ciphertext; raw numbers never
  appear in logs or lookup responses.
- Lookups return `insufficient_reports`, never "safe", when gates are unmet.
- Imports: strict CSV schema, 50k rows / 20 MB, numbers kept as strings, no silent date
  substitution, fingerprint dedup, source approval required to commit observations, batch-level
  rollback that preserves observations still linked to another active batch, formula-escaped
  error CSV.
- External source signals are shown separately and contribute nothing to the community score.
- Current-notice consent is enforced server-side before accepting reports; withdrawal and
  disputes remain available without renewed reporting consent.
- Human review stores one current outcome per report. Replayed/concurrent reviews do not
  inflate trust; holds remove that report's reviewed credit, and corrected decisions replace
  prior credit/penalties. Withdrawal preserves the historical human-review outcome.
- Trust changes enqueue recalculation for every number reported by the affected reporter.
- Failed staging-file deletions are not marked complete and remain eligible for retry.

## Applying the hardening migration

Back up the database and run `pnpm db:migrate` before starting the updated API/worker.
Migration `0001` adds `reports.reviewed_outcome`, reconstructs reviewed counts from report
rows/audit records, and clears previously computed public labels to `insufficient_reports`.
Legacy withdrawn reports are conservatively left without reviewed credit because their
previous state cannot be recovered reliably from the old schema.
The existing daily worker refresh rebuilds these summaries; keep the pilot private until
the affected summaries have been recomputed. Audit entries are retained.

This remains a private pilot, not a production-readiness or security certification.
No government/Truecaller feed or caller-name dataset is included. Production still needs
provider delivery verification, deployment/proxy configuration, dependency review,
backups/monitoring, data-retention and privacy procedures, and an owner-selected license.
The staging cleanup fix retries object deletion; it does **not** implement a general
retention policy for normalized import rows, reports, or authentication records.

## Environment

See [.env.example](.env.example). Without `S3_ENDPOINT` the API and worker store import staging
files under `LOCAL_STORAGE_DIR` (default `/tmp/phone-rep-storage`); use MinIO/S3 for anything
beyond local development.
