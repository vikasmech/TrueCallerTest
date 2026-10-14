import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import type pg from "pg";
import { buildApp } from "./app.js";
import { createDb, createPool } from "./db/client.js";
import { consentEvents, dataSources, disputes, importBatches, magicLinkTokens, reporterQuality, reports, users } from "./db/schema.js";
import { createPhoneCrypto } from "./crypto.js";
import { EnvSchema } from "./env.js";
import { findOrCreatePhone } from "./repos/phones.js";
import { createMemoryStorage } from "./storage/s3.js";
import { expireStagingFiles } from "./services/staging-expiry.js";
import { EMPTY_COUNTS } from "./services/imports.js";
import type { AppContext } from "./context.js";

// Creates and drops ONLY a randomly named database. Never truncates the supplied database.
// TEST_DATABASE_URL must point to a disposable local PostgreSQL with CREATEDB permission.
describe.skipIf(!process.env.TEST_DATABASE_URL)("security regressions with PostgreSQL", () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let app: FastifyInstance;
  let ctx: AppContext;
  let adminCookie: string;
  let userCookie: string;
  let userId: string;
  const database = `phone_rep_test_${randomUUID().replaceAll("-", "")}`;
  const delivered = new Map<string, string>();

  async function signIn(email: string): Promise<{ cookie: string; id: string }> {
    const requested = await app.inject({ method: "POST", url: "/v1/auth/magic-link", payload: { email } });
    expect(requested.statusCode).toBe(202);
    const token = new URL(delivered.get(email)!).searchParams.get("token")!;
    const verified = await app.inject({ method: "GET", url: `/v1/auth/verify?token=${token}` });
    expect(verified.statusCode).toBe(200);
    const setCookie = verified.headers["set-cookie"]!;
    const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
    return { cookie, id: verified.json().id };
  }

  async function quality() {
    const [row] = await ctx.db.select().from(reporterQuality).where(eq(reporterQuality.reporterId, userId));
    return row!;
  }

  async function insertReport(number = "+919876543210") {
    const phone = await findOrCreatePhone(ctx.db, ctx.crypto, number);
    const [row] = await ctx.db.insert(reports).values({
      phoneId: phone.id, reporterId: userId, idempotencyKey: randomUUID(),
      channel: "call", category: "fraud", eventAt: new Date(), status: "accepted",
      reputationEpoch: phone.reputationEpoch,
    }).returning();
    return row!;
  }

  async function decide(id: string, decision = "accept", reasonCode = "verified_incident") {
    return app.inject({
      method: "POST", url: `/v1/admin/reports/${id}/decision`,
      headers: { cookie: adminCookie }, payload: { decision, reasonCode },
    });
  }

  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    admin = createPool(url.toString());
    await admin.query(`CREATE DATABASE "${database}"`);
    url.pathname = `/${database}`;
    pool = createPool(url.toString());
    const db = createDb(pool);
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
    ctx = {
      pool, db,
      env: EnvSchema.parse({
        NODE_ENV: "test", DATABASE_URL: url.toString(),
        SESSION_SECRET: "11".repeat(32), PHONE_HMAC_KEY: "22".repeat(32),
        PHONE_ENC_KEY: "33".repeat(32), ADMIN_EMAILS: "admin@example.com",
      }),
      crypto: createPhoneCrypto({ hmacKeyHex: "22".repeat(32), encKeyHex: "33".repeat(32), keyVersion: 1 }),
      boss: { send: vi.fn().mockResolvedValue("test-job") } as unknown as PgBoss,
      mailer: { async sendMagicLink(email, url) { delivered.set(email, url); } },
      storage: createMemoryStorage(),
    };
  }, 30_000);

  beforeEach(async () => {
    await pool.query("TRUNCATE users, phone_numbers, magic_link_tokens CASCADE");
    ctx.env.ADMIN_EMAILS = ["admin@example.com"];
    ctx.env.NOTICE_VERSION = "2026-10-v1";
    vi.mocked(ctx.boss.send).mockClear();
    app = await buildApp(ctx);
    const adminLogin = await signIn("admin@example.com");
    const userLogin = await signIn("user@example.com");
    adminCookie = adminLogin.cookie;
    userCookie = userLogin.cookie;
    userId = userLogin.id;
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      // pg's pool end can resolve just before the sockets finish closing.
      // Do not FORCE-kill those clients (which emits unhandled client errors).
      for (let attempt = 0; ; attempt++) {
        try {
          await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
          break;
        } catch (error) {
          if ((error as { code?: string }).code !== "55006" || attempt >= 20) throw error;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      await admin.end();
    }
  });

  // Close the app after every test, including tests that intentionally throw.
  afterEach(async () => { await app?.close(); });

  it("blocks reporting without current consent, but still permits withdrawal", async () => {
    const payload = { phoneNumber: "9876543210", category: "fraud", channel: "call", eventAt: new Date().toISOString(), idempotencyKey: randomUUID() };
    const submit = () => app.inject({ method: "POST", url: "/v1/reports", headers: { cookie: userCookie }, payload });
    expect((await submit()).json().error).toBe("CONSENT_REQUIRED");
    await ctx.db.insert(consentEvents).values({ userId, noticeVersion: "outdated", action: "accepted" });
    expect((await submit()).statusCode).toBe(403);
    await app.inject({ method: "POST", url: "/v1/consent", headers: { cookie: userCookie }, payload: { noticeVersion: ctx.env.NOTICE_VERSION } });
    const created = await submit();
    expect(created.statusCode).toBe(201);
    ctx.env.NOTICE_VERSION = "new-notice";
    const withdrawal = await app.inject({ method: "POST", url: `/v1/reports/${created.json().id}/withdraw`, headers: { cookie: userCookie } });
    expect(withdrawal.statusCode).toBe(204);
    ctx.env.NOTICE_VERSION = "2026-10-v1";
  });

  it("revokes admin privileges for an already-issued session and on the next sign-in", async () => {
    ctx.env.ADMIN_EMAILS = [];
    expect((await app.inject({ method: "GET", url: "/v1/admin/reports", headers: { cookie: adminCookie } })).statusCode).toBe(403);
    const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: adminCookie } });
    expect(me.json().role).toBe("user");
    await signIn("admin@example.com");
    const [adminUser] = await ctx.db.select().from(users).where(eq(users.email, "admin@example.com"));
    expect(adminUser!.role).toBe("user");
  });

  it("counts repeated and concurrent acceptance of one report only once", async () => {
    const report = await insertReport();
    const responses = await Promise.all(Array.from({ length: 5 }, () => decide(report.id)));
    expect(responses.map((r) => r.statusCode)).toEqual([204, 204, 204, 204, 204]);
    expect(await quality()).toMatchObject({ reviewedValidCount: 1, reviewedInvalidCount: 0, qualityTier: "established" });
  });

  it("serializes reviews of different reports by the same reporter", async () => {
    const rows = await Promise.all(Array.from({ length: 5 }, () => insertReport()));
    const responses = await Promise.all(rows.map((row) => decide(row.id)));
    expect(responses.every((r) => r.statusCode === 204)).toBe(true);
    expect(await quality()).toMatchObject({ reviewedValidCount: 5, qualityTier: "reviewed_valid_history" });
  });

  it("replaces the prior outcome rather than stacking trust or penalties", async () => {
    const report = await insertReport();
    expect((await decide(report.id)).statusCode).toBe(204);
    expect((await decide(report.id, "reject", "demonstrably_false")).statusCode).toBe(204);
    expect((await decide(report.id, "reject", "demonstrably_false")).statusCode).toBe(204);
    expect(await quality()).toMatchObject({ reviewedValidCount: 0, reviewedInvalidCount: 1, qualityTier: "new_verified" });
    expect((await decide(report.id)).statusCode).toBe(204);
    expect(await quality()).toMatchObject({ reviewedValidCount: 1, reviewedInvalidCount: 0 });
  });

  it("keeps withdrawn reports withdrawn when moderation is attempted", async () => {
    const report = await insertReport();
    await ctx.db.update(reports).set({ status: "withdrawn" }).where(eq(reports.id, report.id));
    expect((await decide(report.id)).statusCode).toBe(409);
  });

  it("removes reviewed trust while a report is held for review", async () => {
    const report = await insertReport();
    await decide(report.id);
    expect((await decide(report.id, "hold", "needs_review")).statusCode).toBe(204);
    expect(await quality()).toMatchObject({ reviewedValidCount: 0, qualityTier: "new_verified" });
  });

  it("queues other affected numbers when the reporter's trust changes", async () => {
    const first = await insertReport();
    const second = await insertReport("+919876543211");
    await decide(first.id);
    expect(ctx.boss.send).toHaveBeenCalledWith("recompute-reputation", { phoneId: second.phoneId }, expect.anything());
  });

  it("updates reporter trust after a correction and serializes duplicate dispute decisions", async () => {
    const report = await insertReport();
    await decide(report.id);
    const [dispute] = await ctx.db.insert(disputes).values({
      phoneId: report.phoneId, claimantId: userId, reason: "false_reports",
    }).returning();
    const resolve = () => app.inject({
      method: "POST", url: `/v1/admin/disputes/${dispute!.id}/decision`,
      headers: { cookie: adminCookie },
      payload: { decision: "uphold_correction", invalidateReportIds: [report.id] },
    });
    const responses = await Promise.all([resolve(), resolve()]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([204, 409]);
    expect(await quality()).toMatchObject({ reviewedValidCount: 0, reviewedInvalidCount: 1, qualityTier: "new_verified" });
  });

  it("does not mark failed file deletion complete and retries on the next pass", async () => {
    const [source] = await ctx.db.insert(dataSources).values({
      provider: "test", provenanceGroupId: "test", permittedUse: "test",
      permissionReference: "test-only", displayAllowed: false, createdBy: userId,
    }).returning();
    const [batch] = await ctx.db.insert(importBatches).values({
      sourceId: source!.id, uploaderId: userId, mode: "number_only",
      fileChecksum: "test", idempotencyKey: randomUUID(), objectKey: "test.csv", fileSizeBytes: 1,
      rowCounts: EMPTY_COUNTS, stagingExpiresAt: new Date(0),
    }).returning();
    const storage = createMemoryStorage();
    storage.deleteObject = vi.fn().mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValue(undefined);
    const failed = vi.fn();
    expect(await expireStagingFiles(ctx.db, storage, failed)).toEqual({ deleted: 0, failed: 1 });
    const [pending] = await ctx.db.select().from(importBatches).where(eq(importBatches.id, batch!.id));
    expect(pending!.stagingDeletedAt).toBeNull();
    expect(await expireStagingFiles(ctx.db, storage, failed)).toEqual({ deleted: 1, failed: 0 });
    const [completed] = await ctx.db.select().from(importBatches).where(eq(importBatches.id, batch!.id));
    expect(completed!.stagingDeletedAt).toBeInstanceOf(Date);
    expect(failed).toHaveBeenCalledWith(batch!.id);
  });

  it("repairs legacy inflated counts during the data migration", async () => {
    const report = await insertReport();
    await decide(report.id);
    const withdrawn = await insertReport();
    await decide(withdrawn.id);
    await ctx.db.update(reports).set({ reviewedOutcome: null, status: "withdrawn" }).where(eq(reports.id, withdrawn.id));
    await ctx.db.update(reports).set({ reviewedOutcome: null }).where(eq(reports.id, report.id));
    await ctx.db.update(reporterQuality).set({ reviewedValidCount: 99, qualityTier: "reviewed_valid_history" })
      .where(eq(reporterQuality.reporterId, userId));
    const migration = await readFile(fileURLToPath(new URL("../drizzle/0001_furry_meggan.sql", import.meta.url)), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").slice(1)) await pool.query(statement);
    expect(await quality()).toMatchObject({ reviewedValidCount: 1, qualityTier: "established" });
  });

  it("consumes magic links only once", async () => {
    const url = new URL(delivered.get("user@example.com")!);
    const replay = await app.inject({ method: "GET", url: `/v1/auth/verify?token=${url.searchParams.get("token")}` });
    expect(replay.statusCode).toBe(400);
    expect(await ctx.db.select().from(magicLinkTokens)).not.toHaveLength(0);
  });
});
