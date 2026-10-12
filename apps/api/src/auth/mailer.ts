export type Mailer = {
  sendMagicLink(to: string, url: string): Promise<void>;
};

export function createMailer(kind: "console" | "none", log: (msg: string) => void): Mailer {
  if (kind === "none") {
    return { async sendMagicLink() {} };
  }
  return {
    async sendMagicLink(to, url) {
      log(`[magic-link] to=${to} url=${url}`);
    },
  };
}
