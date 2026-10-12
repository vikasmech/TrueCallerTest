import { describe, expect, it } from "vitest";
import { createPhoneCrypto } from "./crypto.js";

const c = createPhoneCrypto({
  hmacKeyHex: "11".repeat(32),
  encKeyHex: "22".repeat(32),
  keyVersion: 1,
});

describe("phone crypto", () => {
  it("lookup key is deterministic and versioned", () => {
    const a = c.lookupKey("+919876543210");
    expect(a).toBe(c.lookupKey("+919876543210"));
    expect(a.startsWith("v1:")).toBe(true);
    expect(a).not.toBe(c.lookupKey("+919876543211"));
  });

  it("different key versions produce different lookup keys", () => {
    const c2 = createPhoneCrypto({ hmacKeyHex: "33".repeat(32), encKeyHex: "22".repeat(32), keyVersion: 2 });
    expect(c.lookupKey("+919876543210")).not.toBe(c2.lookupKey("+919876543210"));
  });

  it("round-trips encryption with a fresh IV each time", () => {
    const p1 = c.encryptE164("+919876543210");
    const p2 = c.encryptE164("+919876543210");
    expect(p1).not.toBe(p2);
    expect(c.decryptE164(p1)).toBe("+919876543210");
    expect(c.decryptE164(p2)).toBe("+919876543210");
  });

  it("rejects tampered ciphertext", () => {
    const p = c.encryptE164("+919876543210");
    const parts = p.split(":");
    parts[3] = parts[3]!.slice(0, -2) + "AA";
    expect(() => c.decryptE164(parts.join(":"))).toThrow();
  });
});
