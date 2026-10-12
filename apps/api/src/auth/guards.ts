import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "@phone-rep/shared";
import { forbidden, unauthorized } from "../errors.js";

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
