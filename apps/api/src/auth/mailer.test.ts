import { describe, expect, it, vi } from "vitest";
import nodemailer from "nodemailer";
import { createMailer } from "./mailer.js";
import type { Env } from "../env.js";

vi.mock("nodemailer", () => ({ default: { createTransport: vi.fn() } }));

const base = {
  NODE_ENV: "production", MAILER: "smtp", SMTP_HOST: "smtp.example.com",
  SMTP_PORT: 587, SMTP_SECURE: false, SMTP_USER: "test", SMTP_PASS: "test-only",
  SMTP_FROM: "signin@example.com",
} satisfies Partial<Env>;

describe("magic-link mailer", () => {
  it("sends via TLS-required SMTP without logging the token or recipient", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "test" });
    vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail } as never);
    const log = vi.fn();
    await createMailer(base, log).sendMagicLink("person@example.com", "https://example.com/auth/verify?token=test-token");
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      requireTLS: true, logger: false, debug: false, host: base.SMTP_HOST,
    }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: "person@example.com", from: base.SMTP_FROM,
      text: expect.stringContaining("token=test-token"),
      disableFileAccess: true, disableUrlAccess: true,
    }));
    expect(log).not.toHaveBeenCalled();
  });

  it("propagates a delivery failure instead of claiming success", async () => {
    const error = new Error("SMTP unavailable");
    vi.mocked(nodemailer.createTransport).mockReturnValue({
      sendMail: vi.fn().mockRejectedValue(error),
    } as never);
    await expect(createMailer(base, vi.fn()).sendMagicLink("a@example.com", "https://example.com"))
      .rejects.toThrow("SMTP unavailable");
  });

  it.each(["console", "none"] as const)("refuses %s delivery in production even without env parsing", (MAILER) => {
    expect(() => createMailer({ ...base, MAILER }, vi.fn())).toThrow("Production requires SMTP");
  });

  it("rejects incomplete SMTP settings even without env parsing", () => {
    expect(() => createMailer({ ...base, SMTP_PASS: undefined }, vi.fn())).toThrow("incomplete");
  });
});
