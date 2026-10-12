import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  AdminReportRow,
  DisputeDecisionRequest,
  DisputeSummary,
  POLICY_VERSION,
  ReportDecisionRequest,
  ReportStatus,
  maskE164,
} from "@phone-rep/shared";
import type { AppContext } from "../context.js";
import { withTransaction } from "../db/client.js";
import {
  disputes,
  moderationActions,
  phoneNumbers,
  reporterQuality,
  reports,
} from "../db/schema.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { requireModerator } from "../auth/guards.js";
import { enqueueRecompute, txDb } from "../queue.js";
import { toSummary } from "./disputes.js";

const REVIEWED_VALID_FOR_PROMOTION = 5;

export const adminModerationRoutes: (ctx: AppContext) => FastifyPluginAsyncZod =
  (ctx) => async (app) => {
    app.get(
      "/v1/admin/reports",
      {
        preHandler: requireModerator,
        schema: {
          querystring: z.object({ status: ReportStatus.default("in_review"), limit: z.coerce.number().int().min(1).max(200).default(50) }),
          response: { 200: z.array(AdminReportRow) },
        },
      },
      async (req) => {
        const rows = await ctx.db
          .select({ r: reports, enc: phoneNumbers.encryptedE164, tier: reporterQuality.qualityTier })
          .from(reports)
          .innerJoin(phoneNumbers, eq(phoneNumbers.id, reports.phoneId))
          .leftJoin(reporterQuality, eq(reporterQuality.reporterId, reports.reporterId))
          .where(eq(reports.status, req.query.status))
          .orderBy(desc(reports.submittedAt))
          .limit(req.query.limit);
        return rows.map(({ r, enc, tier }) => ({
          id: r.id,
          phoneNumberMasked: maskE164(ctx.crypto.decryptE164(enc)),
          reporterId: r.reporterId,
          reporterTier: tier ?? "new_verified",
          channel: r.channel,
          category: r.category,
          eventAt: r.eventAt.toISOString(),
          submittedAt: r.submittedAt.toISOString(),
          status: r.status,
          screeningReason: r.screeningReason,
          coordinationHold: r.coordinationHold,
        }));
      },
    );

    app.post(
      "/v1/admin/reports/:id/decision",
      {
        preHandler: requireModerator,
        schema: { params: z.object({ id: z.string().uuid() }), body: ReportDecisionRequest },
      },
      async (req, reply) => {
        const [r] = await ctx.db.select().from(reports).where(eq(reports.id, req.params.id)).limit(1);
        if (!r) throw notFound("Report");
        if (r.status === "withdrawn") throw conflict("WITHDRAWN", "Withdrawn reports cannot be moderated.");
        const { decision, reasonCode, newCategory, note } = req.body;
        if (decision === "recategorize" && !newCategory) {
          throw badRequest("MISSING_CATEGORY", "newCategory is required to recategorize.");
        }

        await withTransaction(ctx.pool, async (tx, client) => {
          const patch: Partial<typeof reports.$inferInsert> = {};
          if (decision === "accept") Object.assign(patch, { status: "accepted", coordinationHold: false });
          if (decision === "reject") Object.assign(patch, { status: "rejected" });
          if (decision === "hold") Object.assign(patch, { status: "in_review", coordinationHold: reasonCode === "suspected_coordination" });
          if (decision === "recategorize") Object.assign(patch, { category: newCategory, status: "accepted", coordinationHold: false });
          patch.screeningReason = reasonCode;
          await tx.update(reports).set(patch).where(eq(reports.id, r.id));

          if (decision === "accept" || decision === "recategorize") {
            await bumpQuality(tx, r.reporterId, "valid");
          } else if (decision === "reject" && reasonCode === "demonstrably_false") {
            await bumpQuality(tx, r.reporterId, "invalid");
          }

          await tx.insert(moderationActions).values({
            actorId: req.user!.id,
            targetType: "report",
            targetId: r.id,
            action: decision,
            reasonCode,
            note: note ?? null,
          });
          await enqueueRecompute(ctx.boss, r.phoneId, { db: txDb(client) });
        });
        return reply.code(204).send();
      },
    );

    app.get(
      "/v1/admin/disputes",
      {
        preHandler: requireModerator,
        schema: {
          querystring: z.object({ status: z.enum(["open", "resolved"]).default("open") }),
          response: { 200: z.array(DisputeSummary) },
        },
      },
      async (req) => {
        const rows = await ctx.db
          .select({ d: disputes, enc: phoneNumbers.encryptedE164 })
          .from(disputes)
          .innerJoin(phoneNumbers, eq(phoneNumbers.id, disputes.phoneId))
          .where(eq(disputes.status, req.query.status))
          .orderBy(desc(disputes.createdAt))
          .limit(100);
        return rows.map(({ d, enc }) => toSummary(ctx, d, enc));
      },
    );

    app.post(
      "/v1/admin/disputes/:id/decision",
      {
        preHandler: requireModerator,
        schema: { params: z.object({ id: z.string().uuid() }), body: DisputeDecisionRequest },
      },
      async (req, reply) => {
        const [d] = await ctx.db.select().from(disputes).where(eq(disputes.id, req.params.id)).limit(1);
        if (!d) throw notFound("Dispute");
        if (d.status === "resolved") throw conflict("RESOLVED", "Dispute already resolved.");
        const { decision, note, invalidateReportIds } = req.body;

        await withTransaction(ctx.pool, async (tx, client) => {
          const now = new Date();
          await tx
            .update(disputes)
            .set({ status: "resolved", decision, decisionAt: now })
            .where(eq(disputes.id, d.id));

          if (decision === "uphold_correction" && invalidateReportIds?.length) {
            await tx
              .update(reports)
              .set({ status: "rejected", screeningReason: "demonstrably_false" })
              .where(and(eq(reports.phoneId, d.phoneId), inArray(reports.id, invalidateReportIds)));
          }
          if (decision === "uphold_reassignment") {
            // New epoch: prior reports and observations stop contributing without being deleted.
            await tx
              .update(phoneNumbers)
              .set({ reputationEpoch: sql`${phoneNumbers.reputationEpoch} + 1` })
              .where(eq(phoneNumbers.id, d.phoneId));
          }

          await tx.insert(moderationActions).values({
            actorId: req.user!.id,
            targetType: "dispute",
            targetId: d.id,
            action: decision,
            reasonCode: null,
            note: note ?? null,
          });
          await enqueueRecompute(ctx.boss, d.phoneId, { db: txDb(client) });
        });
        return reply.code(204).send();
      },
    );
  };

async function bumpQuality(
  tx: Parameters<Parameters<typeof withTransaction>[1]>[0],
  reporterId: string,
  kind: "valid" | "invalid",
) {
  const inc = kind === "valid" ? { reviewedValidCount: sql`${reporterQuality.reviewedValidCount} + 1` } : { reviewedInvalidCount: sql`${reporterQuality.reviewedInvalidCount} + 1` };
  const [q] = await tx
    .insert(reporterQuality)
    .values({ reporterId, policyVersion: POLICY_VERSION, ...(kind === "valid" ? { reviewedValidCount: 1 } : { reviewedInvalidCount: 1 }) })
    .onConflictDoUpdate({ target: reporterQuality.reporterId, set: { ...inc, updatedAt: new Date() } })
    .returning();
  if (!q) return;
  // Promotion requires reviewed outcomes; any reviewed-invalid report demotes to new_verified.
  const tier =
    q.reviewedInvalidCount > 0
      ? "new_verified"
      : q.reviewedValidCount >= REVIEWED_VALID_FOR_PROMOTION
        ? "reviewed_valid_history"
        : q.reviewedValidCount >= 1
          ? "established"
          : "new_verified";
  if (tier !== q.qualityTier) {
    await tx.update(reporterQuality).set({ qualityTier: tier }).where(eq(reporterQuality.reporterId, reporterId));
  }
}
