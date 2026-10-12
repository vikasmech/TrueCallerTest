import "@fastify/secure-session";
import type { Role } from "@phone-rep/shared";

declare module "@fastify/secure-session" {
  interface SessionData {
    userId: string;
  }
}

declare module "fastify" {
  interface FastifyRequest {
    user: {
      id: string;
      email: string;
      role: Role;
      verifiedContact: boolean;
      restricted: boolean;
    } | null;
  }
}
