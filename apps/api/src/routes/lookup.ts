import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import {
  LOOKUP_WARNING,
  LookupRequest,
  LookupResponse,
  POLICY_VERSION,
  normalizePhone,
  supportBand,
  type Category,
  type LookupResponse as LookupResponseT,
} from "@phone-rep/shared";
import type { AppContext } from "../context.js";
import { dataSources, disputes, reputations, sourceObservations } from "../db/schema.js";
import { badRequest } from "../errors.js";
import { requireUser } from "../auth/guards.js";
import { findPhoneByE164 } from "../repos/phones.js";

const UNKNOWN = { score: null, label: "insufficient_reports" } as const;

export const lookupRoutes: (ctx: AppContext) => FastifyPluginAsyncZod = (ctx) => async (app) => {
  app.post(
    "/v1/lookup",
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 60, timeWindow: "1 hour" } },
      schema: { body: LookupRequest, response: { 200: LookupResponse } },
    },
    async (req) => {
      const norm = normalizePhone(req.body.phoneNumber);
      if (!norm.ok) throw badRequest(norm.error.code, norm.error.message);

      const phone = await findPhoneByE164(ctx.db, ctx.crypto, norm.value.e164);
      const base: LookupResponseT = {
        identifier_type: "phone",
        fraud: UNKNOWN,
        spam: UNKNOWN,
        external_signals: [],
        dispute_status: "none",
        computed_at: null,
        policy_version: POLICY_VERSION,
        warning: LOOKUP_WARNING,
      };
      if (!phone) return base;

      const now = new Date();
      const [reps, obs, openDispute] = await Promise.all([
        ctx.db.select().from(reputations).where(eq(reputations.phoneId, phone.id)),
        ctx.db
          .select({ o: sourceObservations, s: dataSources })
          .from(sourceObservations)
          .innerJoin(dataSources, eq(dataSources.id, sourceObservations.sourceId))
          .where(
            and(
              eq(sourceObservations.phoneId, phone.id),
              eq(sourceObservations.status, "active"),
              eq(sourceObservations.reputationEpoch, phone.reputationEpoch),
              or(isNull(sourceObservations.expiresAt), gt(sourceObservations.expiresAt, now)),
              eq(dataSources.reviewStatus, "approved"),
              eq(dataSources.displayAllowed, true),
              or(isNull(dataSources.validUntil), gt(dataSources.validUntil, now)),
            ),
          ),
        ctx.db
          .select({ id: disputes.id })
          .from(disputes)
          .where(and(eq(disputes.phoneId, phone.id), eq(disputes.status, "open")))
          .limit(1),
      ]);

      const signal = (cat: Category): LookupResponseT["fraud"] => {
        const r = reps.find((x) => x.category === cat);
        if (!r || r.publicLabel === "insufficient_reports") return UNKNOWN;
        return {
          score: r.score,
          score_type: "community_report_strength",
          label: r.publicLabel,
          support_band: supportBand(r.recentEligibleReporterCount),
        };
      };

      const computedAt = reps.reduce<Date | null>(
        (acc, r) => (!acc || r.computedAt > acc ? r.computedAt : acc),
        null,
      );

      return {
        ...base,
        fraud: signal("fraud"),
        spam: signal("spam"),
        external_signals: obs.map(({ o, s }) => ({
          source_name: s.provider,
          category: o.category,
          observed_at: o.observedAt.toISOString(),
          source_score: o.sourceScore === null ? null : Number(o.sourceScore),
          source_score_scale: o.sourceScoreScale,
          expires_at: o.expiresAt?.toISOString() ?? null,
        })),
        dispute_status: openDispute.length ? ("open" as const) : ("none" as const),
        computed_at: computedAt?.toISOString() ?? null,
      };
    },
  );
};
