import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import secureSession from "@fastify/secure-session";
import multipart from "@fastify/multipart";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { IMPORT_LIMITS } from "@phone-rep/shared";
import type { AppContext } from "./context.js";
import { users } from "./db/schema.js";
import { HttpError } from "./errors.js";
import { authRoutes } from "./routes/auth.js";
import { reportRoutes } from "./routes/reports.js";
import { lookupRoutes } from "./routes/lookup.js";
import { disputeRoutes } from "./routes/disputes.js";
import { adminModerationRoutes } from "./routes/admin-moderation.js";
import { adminSourceRoutes } from "./routes/admin-sources.js";
import { adminImportRoutes } from "./routes/admin-imports.js";
import { roleForEmail } from "./auth/roles.js";

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: ctx.env.NODE_ENV === "production" ? "info" : "debug",
      // Magic-link URLs contain bearer tokens. Keep query strings out of access logs.
      serializers: {
        req: (req) => ({
          method: req.method,
          url: req.url?.split("?")[0],
          remoteAddress: req.ip,
        }),
      },
      redact: {
        paths: [
          "req.headers.cookie",
          "req.headers.authorization",
          "req.body.phoneNumber",
          "req.body.email",
          "req.query.token",
          "req.headers.referer",
          "res.headers.set-cookie",
        ],
        censor: "[redacted]",
      },
      transport:
        ctx.env.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } }
          : undefined,
    },
    trustProxy: true,
    bodyLimit: 64 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(secureSession, {
    key: Buffer.from(ctx.env.SESSION_SECRET, "hex"),
    cookieName: "prs",
    cookie: {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: ctx.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 14,
    },
  });

  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.session?.get("userId") ?? req.ip,
  });

  await app.register(multipart, {
    limits: { fileSize: IMPORT_LIMITS.maxBytes, files: 1, fields: 8 },
  });

  app.decorateRequest("user", null);
  app.addHook("preHandler", async (req) => {
    const userId = req.session.get("userId");
    if (!userId) return;
    const [u] = await ctx.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) {
      req.session.delete();
      return;
    }
    req.user = {
      id: u.id,
      email: u.email,
      role: roleForEmail(u.email, ctx.env),
      verifiedContact: u.verifiedContact,
      restricted: u.restrictedAt !== null,
    };
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    }
    const e = err as { validation?: unknown; statusCode?: number; message?: string };
    if (err instanceof ZodError || e.validation) {
      return reply.code(400).send({ error: "VALIDATION", message: e.message ?? "Invalid request." });
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: "REQUEST_ERROR", message: e.message ?? "Request error." });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: "INTERNAL", message: "Internal error." });
  });

  app.get("/healthz", async () => ({ ok: true }));

  await app.register(authRoutes(ctx));
  await app.register(reportRoutes(ctx));
  await app.register(lookupRoutes(ctx));
  await app.register(disputeRoutes(ctx));
  await app.register(adminModerationRoutes(ctx));
  await app.register(adminSourceRoutes(ctx));
  await app.register(adminImportRoutes(ctx));

  return app;
}
