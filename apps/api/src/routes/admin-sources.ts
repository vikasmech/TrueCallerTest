import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { CreateDataSourceRequest, DataSourceRow, ReviewDataSourceRequest } from "@phone-rep/shared";
import type { AppContext } from "../context.js";
import { dataSources, moderationActions } from "../db/schema.js";
import { notFound } from "../errors.js";
import { requireAdmin } from "../auth/guards.js";

export const adminSourceRoutes: (ctx: AppContext) => FastifyPluginAsyncZod = (ctx) => async (app) => {
  app.get(
    "/v1/admin/data-sources",
    { preHandler: requireAdmin, schema: { response: { 200: z.array(DataSourceRow) } } },
    async () => {
      const rows = await ctx.db.select().from(dataSources).orderBy(desc(dataSources.createdAt)).limit(200);
      return rows.map(toRow);
    },
  );

  app.post(
    "/v1/admin/data-sources",
    { preHandler: requireAdmin, schema: { body: CreateDataSourceRequest, response: { 201: DataSourceRow } } },
    async (req, reply) => {
      const b = req.body;
      const [row] = await ctx.db
        .insert(dataSources)
        .values({
          provider: b.provider,
          provenanceGroupId: b.provenanceGroupId,
          upstreamProvenance: b.upstreamProvenance ?? null,
          acquiredAt: b.acquiredAt ? new Date(b.acquiredAt) : null,
          permittedUse: b.permittedUse,
          permissionReference: b.permissionReference,
          displayAllowed: b.displayAllowed,
          validUntil: b.validUntil ? new Date(b.validUntil) : null,
          createdBy: req.user!.id,
        })
        .returning();
      return reply.code(201).send(toRow(row!));
    },
  );

  app.post(
    "/v1/admin/data-sources/:id/review",
    {
      preHandler: requireAdmin,
      schema: { params: z.object({ id: z.string().uuid() }), body: ReviewDataSourceRequest, response: { 200: DataSourceRow } },
    },
    async (req) => {
      const [row] = await ctx.db
        .update(dataSources)
        .set({ reviewStatus: req.body.status, reviewedBy: req.user!.id, reviewedAt: new Date() })
        .where(eq(dataSources.id, req.params.id))
        .returning();
      if (!row) throw notFound("Data source");
      await ctx.db.insert(moderationActions).values({
        actorId: req.user!.id,
        targetType: "data_source",
        targetId: row.id,
        action: `review_${req.body.status}`,
        note: req.body.note ?? null,
      });
      return toRow(row);
    },
  );
};

function toRow(s: typeof dataSources.$inferSelect): z.infer<typeof DataSourceRow> {
  return {
    id: s.id,
    provider: s.provider,
    provenanceGroupId: s.provenanceGroupId,
    permittedUse: s.permittedUse,
    permissionReference: s.permissionReference,
    displayAllowed: s.displayAllowed,
    reviewStatus: s.reviewStatus,
    validUntil: s.validUntil?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}
