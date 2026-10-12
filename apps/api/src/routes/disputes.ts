import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { CreateDisputeRequest, DisputeSummary, maskE164, normalizePhone } from "@phone-rep/shared";
import type { AppContext } from "../context.js";
import { disputes, phoneNumbers } from "../db/schema.js";
import { badRequest } from "../errors.js";
import { requireUser } from "../auth/guards.js";
import { findOrCreatePhone } from "../repos/phones.js";

export const disputeRoutes: (ctx: AppContext) => FastifyPluginAsyncZod = (ctx) => async (app) => {
  app.post(
    "/v1/disputes",
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 5, timeWindow: "1 day" } },
      schema: { body: CreateDisputeRequest, response: { 201: z.object({ id: z.string().uuid() }) } },
    },
    async (req, reply) => {
      const norm = normalizePhone(req.body.phoneNumber);
      if (!norm.ok) throw badRequest(norm.error.code, norm.error.message);
      // A dispute may precede any report; the number record is created so the status is visible.
      const phone = await findOrCreatePhone(ctx.db, ctx.crypto, norm.value.e164);
      const [row] = await ctx.db
        .insert(disputes)
        .values({
          phoneId: phone.id,
          claimantId: req.user!.id,
          reason: req.body.reason,
          details: req.body.details ?? null,
        })
        .returning({ id: disputes.id });
      return reply.code(201).send({ id: row!.id });
    },
  );

  app.get(
    "/v1/disputes/mine",
    { preHandler: requireUser, schema: { response: { 200: z.array(DisputeSummary) } } },
    async (req) => {
      const rows = await ctx.db
        .select({ d: disputes, enc: phoneNumbers.encryptedE164 })
        .from(disputes)
        .innerJoin(phoneNumbers, eq(phoneNumbers.id, disputes.phoneId))
        .where(eq(disputes.claimantId, req.user!.id))
        .orderBy(desc(disputes.createdAt))
        .limit(100);
      return rows.map(({ d, enc }) => toSummary(ctx, d, enc));
    },
  );
};

export function toSummary(
  ctx: AppContext,
  d: typeof disputes.$inferSelect,
  encryptedE164: string,
): z.infer<typeof DisputeSummary> {
  return {
    id: d.id,
    phoneNumberMasked: maskE164(ctx.crypto.decryptE164(encryptedE164)),
    reason: d.reason,
    details: d.details,
    status: d.status,
    decision: d.decision,
    createdAt: d.createdAt.toISOString(),
    decisionAt: d.decisionAt?.toISOString() ?? null,
  };
}
