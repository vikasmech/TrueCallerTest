import nodemailer from "nodemailer";
import type { Env } from "../env.js";

export type Mailer = {
  sendMagicLink(to: string, url: string): Promise<void>;
};

export function createMailer(
  env: Pick<Env, "NODE_ENV" | "MAILER" | "SMTP_HOST" | "SMTP_PORT" | "SMTP_SECURE" | "SMTP_USER" | "SMTP_PASS" | "SMTP_FROM">,
  log: (msg: string) => void,
): Mailer {
  if (env.NODE_ENV === "production" && env.MAILER !== "smtp") {
    throw new Error("Production requires SMTP delivery.");
  }
  if (env.MAILER === "smtp") {
    if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS || !env.SMTP_FROM) {
      throw new Error("SMTP configuration is incomplete.");
    }
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      // Port 587 must upgrade using STARTTLS; never send credentials over plaintext.
      requireTLS: true,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      logger: false,
      debug: false,
    });
    return {
      async sendMagicLink(to, url) {
        await transport.sendMail({
          from: env.SMTP_FROM,
          to,
          subject: "Sign in to Phone Reputation",
          text: `Use this single-use link to sign in. It expires in 15 minutes:\n\n${url}\n\nIf you did not request this email, ignore it.`,
          disableFileAccess: true,
          disableUrlAccess: true,
        });
      },
    };
  }
  if (env.MAILER === "none") {
    return { async sendMagicLink() {} };
  }
  return {
    async sendMagicLink(to, url) {
      log(`[magic-link] to=${to} url=${url}`);
    },
  };
}
