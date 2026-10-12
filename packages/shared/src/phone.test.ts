import { describe, expect, it } from "vitest";
import { normalizePhone } from "./phone.js";
import { csvCell, escapeCsvFormula, maskE164 } from "./util.js";

describe("normalizePhone", () => {
  it("normalizes Indian mobile numbers in several formats", () => {
    for (const input of ["9876543210", "09876543210", "+91 98765 43210", "0091-9876543210"]) {
      const r = normalizePhone(input);
      expect(r.ok, input).toBe(true);
      if (r.ok) {
        expect(r.value.e164).toBe("+919876543210");
        expect(r.value.country).toBe("IN");
      }
    }
  });

  it("accepts Indian landlines", () => {
    const r = normalizePhone("011 2345 6789");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.e164).toBe("+911123456789");
  });

  it("rejects invalid and empty input", () => {
    expect(normalizePhone("12345").ok).toBe(false);
    expect(normalizePhone("").ok).toBe(false);
    expect(normalizePhone("abc").ok).toBe(false);
  });

  it("accepts foreign numbers with explicit country code", () => {
    const r = normalizePhone("+44 20 7946 0958");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.country).toBe("GB");
  });
});

describe("util", () => {
  it("masks numbers", () => {
    expect(maskE164("+919876543210")).toBe("+91XXXXXX3210");
  });
  it("escapes formula-leading cells", () => {
    expect(escapeCsvFormula("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(escapeCsvFormula("+919876543210")).toBe("'+919876543210");
    expect(escapeCsvFormula("hello")).toBe("hello");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
  });
});
