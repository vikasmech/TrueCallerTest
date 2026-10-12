import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

export type PhoneCrypto = {
  keyVersion: number;
  lookupKey(e164: string): string;
  encryptE164(e164: string): string;
  decryptE164(payload: string): string;
};

export function createPhoneCrypto(opts: {
  hmacKeyHex: string;
  encKeyHex: string;
  keyVersion: number;
}): PhoneCrypto {
  const hmacKey = Buffer.from(opts.hmacKeyHex, "hex");
  const encKey = Buffer.from(opts.encKeyHex, "hex");
  if (hmacKey.length !== 32 || encKey.length !== 32) {
    throw new Error("PHONE_HMAC_KEY and PHONE_ENC_KEY must be 32 bytes");
  }
  return {
    keyVersion: opts.keyVersion,
    lookupKey(e164) {
      return `v${opts.keyVersion}:${createHmac("sha256", hmacKey).update(e164).digest("base64url")}`;
    },
    encryptE164(e164) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", encKey, iv);
      const ct = Buffer.concat([cipher.update(e164, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `v${opts.keyVersion}:${iv.toString("base64url")}:${tag.toString("base64url")}:${ct.toString("base64url")}`;
    },
    decryptE164(payload) {
      const [, ivB64, tagB64, ctB64] = payload.split(":");
      if (!ivB64 || !tagB64 || !ctB64) throw new Error("malformed ciphertext");
      const decipher = createDecipheriv("aes-256-gcm", encKey, Buffer.from(ivB64, "base64url"));
      decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(ctB64, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
