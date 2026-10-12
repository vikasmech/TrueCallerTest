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

- Node 18.18+ and pnpm 9 (`npm i -g pnpm`)
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
Emails listed in `ADMIN_EMAILS` / `MODERATOR_EMAILS` receive that role on sign-in.

Seeded lookups (after `pnpm db:seed`): `+919000000001` (strong fraud signal),
`+919000000002` (some suspicious reports), `+919000000003` (spam only).

## Tests

```bash
pnpm test        # vitest: scoring, normalization, crypto, CSV import parsing
pnpm typecheck
```

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

## Environment

See [.env.example](.env.example). Without `S3_ENDPOINT` the API and worker store import staging
files under `LOCAL_STORAGE_DIR` (default `/tmp/phone-rep-storage`); use MinIO/S3 for anything
beyond local development.
