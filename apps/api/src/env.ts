import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

config({ path: resolve(fileURLToPath(import.meta.url), "../../../../.env") });

const hex32 = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, "must be 32 bytes hex (64 chars)");

const csvList = z
  .string()
  .default("")
  .transform((s) =>
    s
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  );

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().default(4000),
  API_HOST: z.string().default("0.0.0.0"),
  WEB_BASE_URL: z.string().url().default("http://localhost:3000"),
  SESSION_SECRET: hex32,
  PHONE_HMAC_KEY: hex32,
  PHONE_ENC_KEY: hex32,
  PHONE_KEY_VERSION: z.coerce.number().int().positive().default(1),
  ADMIN_EMAILS: csvList,
  MODERATOR_EMAILS: csvList,
  MAILER: z.enum(["console", "none", "smtp"]).default("console"),
  SMTP_HOST: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  SMTP_USER: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_PASS: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_FROM: z.preprocess(emptyToUndefined, z.string().email().optional()),
  S3_ENDPOINT: z.preprocess(emptyToUndefined, z.string().url().optional()),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  S3_SECRET_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  S3_BUCKET_IMPORTS: z.string().default("import-staging"),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  // Used only when S3_ENDPOINT is unset (development without MinIO).
  LOCAL_STORAGE_DIR: z.string().default("/tmp/phone-rep-storage"),
  NOTICE_VERSION: z.string().default("2026-10-v1"),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === "production" && env.MAILER !== "smtp") {
    ctx.addIssue({ code: "custom", path: ["MAILER"], message: "Production requires MAILER=smtp; console/none are development-only." });
  }
  if (env.NODE_ENV === "production" && !env.WEB_BASE_URL.startsWith("https://")) {
    ctx.addIssue({ code: "custom", path: ["WEB_BASE_URL"], message: "Production magic links require HTTPS." });
  }
  if (env.MAILER === "smtp") {
    for (const key of ["SMTP_HOST", "SMTP_FROM", "SMTP_USER", "SMTP_PASS"] as const) {
      if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required for SMTP.` });
    }
  }
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;
export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
