import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { IMPORT_LIMITS, ImportBatchRow, ImportMode, ImportRowErrorRow } from "@phone-rep/shared";
import type { AppContext } from "../context.js";
import { sha256Hex } from "../crypto.js";
import { dataSources, importBatches, importRows } from "../db/schema.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { requireAdmin } from "../auth/guards.js";
import { QUEUES, type ImportBatchJob } from "../queue.js";
import { EMPTY_COUNTS, buildRowErrorCsv } from "../services/imports.js";

const STAGING_TTL_MS = 7 * 24 * 3600 * 1000;

export const adminImportRoutes: (ctx: AppContext) => FastifyPluginAsyncZod = (ctx) => async (app) => {
  app.get(
    "/v1/admin/imports",
    { preHandler: requireAdmin, schema: { response: { 200: z.array(ImportBatchRow) } } },
    async () => {
      const rows = await ctx.db
        .select({ b: importBatches, s: dataSources })
        .from(importBatches)
        .innerJoin(dataSources, eq(dataSources.id, importBatches.sourceId))
        .orderBy(desc(importBatches.createdAt))
        .limit(100);
      return rows.map(({ b, s }) => toRow(b, s));
    },
  );

  app.post("/v1/admin/imports", { preHandler: requireAdmin }, async (req, reply) => {
    const file = await req.file();
    if (!file) throw badRequest("MISSING_FILE", "Attach a CSV file in the 'file' field.");
    const fields = Object.fromEntries(
      Object.entries(file.fields).map(([k, v]) => [k, Array.isArray(v) ? undefined : (v as { value?: unknown }).value]),
    );
    const meta = z
      .object({
        sourceId: z.string().uuid(),
        idempotencyKey: z.string().min(8).max(128),
        mode: ImportMode,
        checksum: z.string().regex(/^[0-9a-f]{64}$/).optional(),
      })
      .parse(fields);

    if (meta.mode === "synthetic_test" && ctx.env.NODE_ENV === "production") {
      throw forbidden("Synthetic seeds are not allowed in production.");
    }
    const [source] = await ctx.db.select().from(dataSources).where(eq(dataSources.id, meta.sourceId)).limit(1);
    if (!source) throw notFound("Data source");
    if (source.reviewStatus === "rejected") throw conflict("SOURCE_REJECTED", "Rejected sources cannot be imported.");

    const buf = await file.toBuffer();
    if (file.file.truncated || buf.length > IMPORT_LIMITS.maxBytes) throw badRequest("FILE_TOO_LARGE", "File exceeds 20 MB.");
    const checksum = sha256Hex(buf);
    if (meta.checksum && meta.checksum !== checksum) throw badRequest("CHECKSUM_MISMATCH", "Uploaded bytes do not match the provided checksum.");

    const [existing] = await ctx.db
      .select({ b: importBatches, s: dataSources })
      .from(importBatches)
      .innerJoin(dataSources, eq(dataSources.id, importBatches.sourceId))
      .where(eq(importBatches.idempotencyKey, meta.idempotencyKey))
      .limit(1);
    if (existing && existing.b.sourceId === meta.sourceId) return reply.code(200).send(toRow(existing.b, existing.s));

    const objectKey = `imports/${meta.sourceId}/${checksum}.csv`;
    await ctx.storage.putObject(objectKey, buf, "text/csv");

    const [batch] = await ctx.db
      .insert(importBatches)
      .values({
        sourceId: meta.sourceId,
        uploaderId: req.user!.id,
        mode: meta.mode,
        fileChecksum: checksum,
        idempotencyKey: meta.idempotencyKey,
        objectKey,
        fileSizeBytes: buf.length,
        rowCounts: EMPTY_COUNTS,
        stagingExpiresAt: new Date(Date.now() + STAGING_TTL_MS),
      })
      .onConflictDoNothing({ target: [importBatches.sourceId, importBatches.idempotencyKey] })
      .returning();
    if (!batch) throw conflict("DUPLICATE_IMPORT", "An import with this idempotency key already exists.");

    await ctx.boss.send(QUEUES.importParse, { batchId: batch.id } satisfies ImportBatchJob, { singletonKey: batch.id });
    return reply.code(202).send(toRow(batch, source));
  });

  app.get(
    "/v1/admin/imports/:id",
    { preHandler: requireAdmin, schema: { params: z.object({ id: z.string().uuid() }), response: { 200: ImportBatchRow } } },
    async (req) => {
      const row = await loadBatch(ctx, req.params.id);
      return toRow(row.b, row.s);
    },
  );

  app.get(
    "/v1/admin/imports/:id/errors",
    {
      preHandler: requireAdmin,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({ format: z.enum(["json", "csv"]).default("json") }),
      },
    },
    async (req, reply) => {
      await loadBatch(ctx, req.params.id);
      if (req.query.format === "csv") {
        const csv = await buildRowErrorCsv(ctx.db, req.params.id);
        return reply
          .header("content-type", "text/csv; charset=utf-8")
          .header("content-disposition", `attachment; filename="import-${req.params.id}-errors.csv"`)
          .header("cache-control", "private, no-store")
          .send(csv);
      }
      const rows = await ctx.db
        .select({ rowNumber: importRows.rowNumber, status: importRows.validationStatus, errorCode: importRows.errorCode })
        .from(importRows)
        .where(eq(importRows.batchId, req.params.id))
        .orderBy(importRows.rowNumber)
        .limit(1000);
      return z.array(ImportRowErrorRow).parse(rows.filter((r) => r.errorCode));
    },
  );

  app.post(
    "/v1/admin/imports/:id/commit",
    { preHandler: requireAdmin, schema: { params: z.object({ id: z.string().uuid() }), response: { 202: ImportBatchRow } } },
    async (req, reply) => {
      const { b, s } = await loadBatch(ctx, req.params.id);
      if (b.state !== "previewed") throw conflict("NOT_PREVIEWED", `Batch is in state ${b.state}.`);
      if (b.uploaderId === req.user!.id && ctx.env.NODE_ENV === "production") {
        throw forbidden("A different administrator must review and commit an import.");
      }
      if (b.mode !== "number_only" && s.reviewStatus !== "approved") {
        throw conflict("SOURCE_NOT_APPROVED", "Source must be approved before observations can be committed.");
      }
      if (s.validUntil && s.validUntil.getTime() <= Date.now()) throw conflict("SOURCE_EXPIRED", "Source permission has expired.");

      const [updated] = await ctx.db
        .update(importBatches)
        .set({ state: "committing", reviewerId: req.user!.id })
        .where(eq(importBatches.id, b.id))
        .returning();
      await ctx.boss.send(QUEUES.importCommit, { batchId: b.id } satisfies ImportBatchJob, { singletonKey: b.id });
      return reply.code(202).send(toRow(updated!, s));
    },
  );

  app.post(
    "/v1/admin/imports/:id/rollback",
    { preHandler: requireAdmin, schema: { params: z.object({ id: z.string().uuid() }), response: { 202: ImportBatchRow } } },
    async (req, reply) => {
      const { b, s } = await loadBatch(ctx, req.params.id);
      if (b.state !== "committed" && b.state !== "commit_failed") throw conflict("NOT_COMMITTED", `Batch is in state ${b.state}.`);
      const [updated] = await ctx.db
        .update(importBatches)
        .set({ state: "revoked", revokedAt: new Date() })
        .where(eq(importBatches.id, b.id))
        .returning();
      await ctx.boss.send(QUEUES.importRollback, { batchId: b.id } satisfies ImportBatchJob, { singletonKey: b.id });
      return reply.code(202).send(toRow(updated!, s));
    },
  );
};

async function loadBatch(ctx: AppContext, id: string) {
  const [row] = await ctx.db
    .select({ b: importBatches, s: dataSources })
    .from(importBatches)
    .innerJoin(dataSources, eq(dataSources.id, importBatches.sourceId))
    .where(eq(importBatches.id, id))
    .limit(1);
  if (!row) throw notFound("Import batch");
  return row;
}

function toRow(b: typeof importBatches.$inferSelect, s: typeof dataSources.$inferSelect): z.infer<typeof ImportBatchRow> {
  const publishable =
    b.mode !== "number_only" &&
    s.reviewStatus === "approved" &&
    s.displayAllowed &&
    (!s.validUntil || s.validUntil.getTime() > Date.now());
  return {
    id: b.id,
    sourceId: b.sourceId,
    sourceProvider: s.provider,
    sourceReviewStatus: s.reviewStatus,
    mode: b.mode,
    state: b.state,
    uploaderId: b.uploaderId,
    reviewerId: b.reviewerId,
    fileChecksum: b.fileChecksum,
    idempotencyKey: b.idempotencyKey,
    rowCounts: b.rowCounts,
    error: b.error,
    publishable,
    createdAt: b.createdAt.toISOString(),
    committedAt: b.committedAt?.toISOString() ?? null,
    revokedAt: b.revokedAt?.toISOString() ?? null,
  };
}
