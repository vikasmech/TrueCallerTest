import { describe, expect, it } from "vitest";
import { roleForEmail } from "./roles.js";
import { EnvSchema } from "../env.js";
import { qualityTier } from "../services/reporter-quality.js";

const settings = {
  ADMIN_EMAILS: ["admin@example.com"],
  MODERATOR_EMAILS: ["mod@example.com"],
};

describe("authoritative role allowlists", () => {
  it("normalizes emails and gives admin precedence", () => {
    expect(roleForEmail(" ADMIN@example.com ", settings)).toBe("admin");
    expect(roleForEmail("mod@example.com", settings)).toBe("moderator");
    expect(roleForEmail("user@example.com", settings)).toBe("user");
    expect(roleForEmail("admin@example.com", { ...settings, MODERATOR_EMAILS: ["admin@example.com"] })).toBe("admin");
  });

  it("removes a role immediately when the allowlist changes", () => {
    expect(roleForEmail("admin@example.com", { ADMIN_EMAILS: [], MODERATOR_EMAILS: [] })).toBe("user");
    expect(roleForEmail("admin@example.com", { ADMIN_EMAILS: [], MODERATOR_EMAILS: ["admin@example.com"] })).toBe("moderator");
  });
});

describe("production mail configuration", () => {
  const required = {
    DATABASE_URL: "postgres://test:test@localhost/test",
    SESSION_SECRET: "11".repeat(32),
    PHONE_HMAC_KEY: "22".repeat(32),
    PHONE_ENC_KEY: "33".repeat(32),
  };
  const production = {
    ...required,
    NODE_ENV: "production",
    WEB_BASE_URL: "https://example.com",
    MAILER: "smtp",
    SMTP_HOST: "smtp.example.com",
    SMTP_USER: "test-user",
    SMTP_PASS: "test-only-password",
    SMTP_FROM: "signin@example.com",
  };

  it("allows console mail for local development", () => {
    expect(EnvSchema.parse(required).MAILER).toBe("console");
  });
  it.each(["console", "none"])("rejects %s mail in production", (MAILER) => {
    expect(EnvSchema.safeParse({ ...production, MAILER }).success).toBe(false);
  });
  it("requires complete SMTP configuration", () => {
    for (const field of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]) {
      expect(EnvSchema.safeParse({ ...production, [field]: "" }).success).toBe(false);
    }
  });
  it("requires HTTPS for production sign-in links", () => {
    expect(EnvSchema.safeParse({ ...production, WEB_BASE_URL: "http://example.com" }).success).toBe(false);
  });
  it("accepts SMTP with a validated sender", () => {
    expect(EnvSchema.safeParse(production).success).toBe(true);
    expect(EnvSchema.safeParse({ ...production, SMTP_FROM: "invalid" }).success).toBe(false);
  });
});

describe("reviewed-report quality gates", () => {
  it("requires five distinct valid outcomes for the highest trust tier", () => {
    expect(qualityTier(0, 0)).toBe("new_verified");
    expect(qualityTier(1, 0)).toBe("established");
    expect(qualityTier(4, 0)).toBe("established");
    expect(qualityTier(5, 0)).toBe("reviewed_valid_history");
  });
  it("demotes when any reviewed report is demonstrably false", () => {
    expect(qualityTier(20, 1)).toBe("new_verified");
  });
});
