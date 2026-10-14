import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  CreateReportRequest,
  CreateReportResponse,
  POLICY_V1,
  ReportSummary,
  maskE164,
  normalizePhone,
} from "@phone-rep/shared";
import type { AppContext } from "../context.js";
import { withTransaction } from "../db/client.js";
import { phoneNumbers, reports } from "../db/schema.js";
import { badRequest, forbidden, notFound } from "../errors.js";
import { requireCurrentConsent, requireUnrestricted, requireUser } from "../auth/guards.js";
import { findOrCreatePhone } from "../repos/phones.js";
import { enqueueRecompute, txDb } from "../queue.js";
import { screenReport } from "../services/screening.js";

export const reportRoutes: (ctx: AppContext) => FastifyPluginAsyncZod = (ctx) => async (app) => {
  app.post(
    "/v1/reports",
    {
      preHandler: [requireUser, requireUnrestricted, requireCurrentConsent(ctx)],
      config: { rateLimit: { max: 30, timeWindow: "1 hour" } },
      schema: { body: CreateReportRequest, response: { 201: CreateReportResponse, 200: CreateReportResponse } },
    },
    async (req, reply) => {
      const user = req.user!;
      const now = new Date();

      const existing = await ctx.db
        .select({ id: reports.id, status: reports.status })
        .from(reports)
        .where(and(eq(reports.reporterId, user.id), eq(reports.idempotencyKey, req.body.idempotencyKey)))
        .limit(1);
      if (existing[0]) {
        return reply.code(200).send({ id: existing[0].id, status: existing[0].status, replayed: true });
      }

      const eventAt = new Date(req.body.eventAt);
      if (eventAt.getTime() > now.getTime() + 60_000) {
        throw badRequest("FUTURE_EVENT", "The communication time cannot be in the future.");
      }

      const norm = normalizePhone(req.body.phoneNumber);
      if (!norm.ok) throw badRequest(norm.error.code, norm.error.message);

      const result = await withTransaction(ctx.pool, async (tx, client) => {
        const phone = await findOrCreatePhone(tx, ctx.crypto, norm.value.e164);
        const screening = await screenReport(tx, {
          reporterId: user.id,
          phoneId: phone.id,
          eventAt,
          now,
          backdateReviewDays: POLICY_V1.backdateReviewDays,
        });
        const [row] = await tx
          .insert(reports)
          .values({
            phoneId: phone.id,
            reporterId: user.id,
            idempotencyKey: req.body.idempotencyKey,
            channel: req.body.channel,
            category: req.body.category,
            eventAt,
            status: screening.status,
            screeningReason: screening.reason,
            coordinationHold: screening.coordinationHold,
            reputationEpoch: phone.reputationEpoch,
          })
          .onConflictDoNothing({ target: [reports.reporterId, reports.idempotencyKey] })
          .returning({ id: reports.id, status: reports.status });
        if (!row) return null;
        await enqueueRecompute(ctx.boss, phone.id, { db: txDb(client) });
        return row;
      });

      if (!result) {
        const [replay] = await ctx.db
          .select({ id: reports.id, status: reports.status })
          .from(reports)
          .where(and(eq(reports.reporterId, user.id), eq(reports.idempotencyKey, req.body.idempotencyKey)))
          .limit(1);
        if (!replay) throw new Error("idempotency replay lookup failed");
        return reply.code(200).send({ ...replay, replayed: true });
      }
      return reply.code(201).send({ ...result, replayed: false });
    },
  );

  app.get(
    "/v1/reports/mine",
    { preHandler: requireUser, schema: { response: { 200: z.array(ReportSummary) } } },
    async (req) => {
      const rows = await ctx.db
        .select({ r: reports, enc: phoneNumbers.encryptedE164 })
        .from(reports)
        .innerJoin(phoneNumbers, eq(phoneNumbers.id, reports.phoneId))
        .where(eq(reports.reporterId, req.user!.id))
        .orderBy(desc(reports.submittedAt))
        .limit(200);
      return rows.map(({ r, enc }) => ({
        id: r.id,
        phoneNumberMasked: maskE164(ctx.crypto.decryptE164(enc)),
        channel: r.channel,
        category: r.category,
        eventAt: r.eventAt.toISOString(),
        submittedAt: r.submittedAt.toISOString(),
        status: r.status,
        withdrawnAt: r.withdrawnAt?.toISOString() ?? null,
      }));
    },
  );

  app.post(
    "/v1/reports/:id/withdraw",
    { preHandler: requireUser, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req, reply) => {
      const [r] = await ctx.db.select().from(reports).where(eq(reports.id, req.params.id)).limit(1);
      if (!r) throw notFound("Report");
      if (r.reporterId !== req.user!.id) throw forbidden();
      if (r.status === "withdrawn") return reply.code(204).send();

      await withTransaction(ctx.pool, async (tx, client) => {
        await tx
          .update(reports)
          .set({ status: "withdrawn", withdrawnAt: new Date() })
          .where(eq(reports.id, r.id));
        await enqueueRecompute(ctx.boss, r.phoneId, { db: txDb(client) });
      });
      return reply.code(204).send();
    },
  );
};
