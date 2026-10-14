import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "@phone-rep/shared";
import { forbidden, unauthorized } from "../errors.js";
import { desc, eq } from "drizzle-orm";
import type { AppContext } from "../context.js";
import { consentEvents } from "../db/schema.js";
import { HttpError } from "../errors.js";

const RANK: Record<Role, number> = { user: 0, moderator: 1, admin: 2 };

export function requireRole(min: Role) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    if (!req.user) throw unauthorized();
    if (RANK[req.user.role] < RANK[min]) throw forbidden();
  };
}

export const requireUser = requireRole("user");
export const requireModerator = requireRole("moderator");
export const requireAdmin = requireRole("admin");

export async function requireUnrestricted(req: FastifyRequest) {
  if (!req.user) throw unauthorized();
  if (req.user.restricted) throw forbidden("This account is restricted from reporting.");
}

/** Enforce the current notice at the API boundary, not only in the browser. */
export function requireCurrentConsent(ctx: Pick<AppContext, "db" | "env">) {
  return async (req: FastifyRequest) => {
    if (!req.user) throw unauthorized();
    const [latest] = await ctx.db
      .select({ version: consentEvents.noticeVersion, action: consentEvents.action })
      .from(consentEvents)
      .where(eq(consentEvents.userId, req.user.id))
      .orderBy(desc(consentEvents.createdAt), desc(consentEvents.id))
      .limit(1);
    if (latest?.version !== ctx.env.NOTICE_VERSION || latest.action !== "accepted") {
      throw new HttpError(403, "CONSENT_REQUIRED", "Accept the current privacy notice before reporting.");
    }
  };
}
