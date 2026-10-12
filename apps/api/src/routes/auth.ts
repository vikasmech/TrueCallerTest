import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { ConsentRequest, MagicLinkRequest, MagicLinkVerifyQuery, MeResponse } from "@phone-rep/shared";
import type { AppContext } from "../context.js";
import { randomToken, sha256Hex } from "../crypto.js";
import { consentEvents, magicLinkTokens, reporterQuality, users } from "../db/schema.js";
import { badRequest, unauthorized } from "../errors.js";
import { requireUser } from "../auth/guards.js";

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

export const authRoutes: (ctx: AppContext) => FastifyPluginAsyncZod = (ctx) => async (app) => {
  app.post(
    "/v1/auth/magic-link",
    {
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
      schema: { body: MagicLinkRequest, response: { 202: z.object({ ok: z.literal(true) }) } },
    },
    async (req, reply) => {
      const email = req.body.email.toLowerCase();
      const token = randomToken(32);
      await ctx.db.insert(magicLinkTokens).values({
        tokenHash: sha256Hex(token),
        email,
        expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
      });
      const url = `${ctx.env.WEB_BASE_URL}/auth/verify?token=${encodeURIComponent(token)}`;
      await ctx.mailer.sendMagicLink(email, url);
      return reply.code(202).send({ ok: true });
    },
  );

  app.get(
    "/v1/auth/verify",
    {
      config: { rateLimit: { max: 20, timeWindow: "15 minutes" } },
      schema: { querystring: MagicLinkVerifyQuery, response: { 200: MeResponse } },
    },
    async (req) => {
      const hash = sha256Hex(req.query.token);
      const now = new Date();
      const [row] = await ctx.db
        .update(magicLinkTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(magicLinkTokens.tokenHash, hash),
            isNull(magicLinkTokens.usedAt),
            gt(magicLinkTokens.expiresAt, now),
          ),
        )
        .returning();
      if (!row) throw badRequest("INVALID_TOKEN", "This sign-in link is invalid or has expired.");

      const role = ctx.env.ADMIN_EMAILS.includes(row.email)
        ? "admin"
        : ctx.env.MODERATOR_EMAILS.includes(row.email)
          ? "moderator"
          : "user";

      const [user] = await ctx.db
        .insert(users)
        .values({ email: row.email, role, verifiedContact: true })
        .onConflictDoUpdate({
          target: users.email,
          // Email ownership is re-verified on every magic link; role allowlist can promote.
          set: { verifiedContact: true, ...(role !== "user" ? { role } : {}) },
        })
        .returning();
      if (!user) throw new Error("user upsert failed");

      await ctx.db
        .insert(reporterQuality)
        .values({ reporterId: user.id, policyVersion: "v1" })
        .onConflictDoNothing();

      req.session.set("userId", user.id);
      return toMe(ctx, user);
    },
  );

  app.get("/v1/auth/me", { schema: { response: { 200: MeResponse } } }, async (req) => {
    if (!req.user) throw unauthorized();
    const [user] = await ctx.db.select().from(users).where(eq(users.id, req.user.id)).limit(1);
    if (!user) throw unauthorized();
    return toMe(ctx, user);
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    req.session.delete();
    return reply.code(204).send();
  });

  app.post(
    "/v1/consent",
    { preHandler: requireUser, schema: { body: ConsentRequest } },
    async (req, reply) => {
      if (req.body.noticeVersion !== ctx.env.NOTICE_VERSION) {
        throw badRequest("STALE_NOTICE", "Please review the current notice version.");
      }
      await ctx.db.insert(consentEvents).values({
        userId: req.user!.id,
        noticeVersion: req.body.noticeVersion,
        action: "accepted",
      });
      return reply.code(204).send();
    },
  );
};

async function toMe(ctx: AppContext, user: typeof users.$inferSelect): Promise<MeResponse> {
  const [consent] = await ctx.db
    .select({ v: consentEvents.noticeVersion })
    .from(consentEvents)
    .where(and(eq(consentEvents.userId, user.id), eq(consentEvents.action, "accepted")))
    .orderBy(desc(consentEvents.createdAt))
    .limit(1);
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    verifiedContact: user.verifiedContact,
    consentedNoticeVersion: consent?.v ?? null,
    restricted: user.restrictedAt !== null,
  };
}
