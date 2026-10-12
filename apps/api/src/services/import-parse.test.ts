import { describe, expect, it } from "vitest";
import { observationFingerprint, parseImportCsv } from "./import-parse.js";

const NOW = new Date("2026-10-09T00:00:00Z");
const HEADER = "phone_number,category,observed_at,external_record_id,source_score,source_score_scale,expires_at";

describe("parseImportCsv", () => {
  it("parses valid observation rows and keeps numbers as strings", () => {
    const csv = `${HEADER}\n09876543210,fraud,2026-09-01,ext-1,0.9,0-1,\n+919876543211,spam,2026-09-02T10:00:00Z,,,,2027-01-01`;
    const r = parseImportCsv(Buffer.from(csv), "source_observation", NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]!.e164).toBe("+919876543210");
    expect(r.rows[0]!.sourceScore).toBe("0.9");
    expect(r.rows[1]!.status).toBe("valid");
  });

  it("flags invalid, future, stale and formula-like rows", () => {
    const csv = `${HEADER}\n12,fraud,2026-09-01,,,,\n9876543210,phish,2026-09-01,,,,\n9876543210,fraud,2027-01-01,,,,\n9876543210,fraud,2026-09-01,,,,2026-01-01\n=1+1,fraud,2026-09-01,,,,\n9876543210,fraud,,,,,\n9876543210,fraud,2026-09-01,,5,,`;
    const r = parseImportCsv(Buffer.from(csv), "source_observation", NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows.map((x) => x.errorCode)).toEqual([
      "INVALID_NUMBER",
      "INVALID_CATEGORY",
      "FUTURE_OBSERVED_AT",
      "ALREADY_EXPIRED",
      "INVALID_NUMBER",
      "MISSING_OBSERVED_AT",
      "MISSING_SOURCE_SCORE_SCALE",
    ]);
    expect(r.rows[3]!.status).toBe("stale");
  });

  it("does not substitute the upload date for a missing observed_at", () => {
    const r = parseImportCsv(Buffer.from(`${HEADER}\n9876543210,fraud,,,,,`), "source_observation", NOW);
    if (!r.ok) throw new Error();
    expect(r.rows[0]!.observedAt).toBeNull();
    expect(r.rows[0]!.status).toBe("invalid");
  });

  it("number-only mode needs only phone_number", () => {
    const r = parseImportCsv(Buffer.from(`phone_number\n9876543210\n9876543211`), "number_only", NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows.every((x) => x.status === "valid" && x.category === null)).toBe(true);
  });

  it("rejects unexpected columns and malformed files", () => {
    expect(parseImportCsv(Buffer.from(`phone_number,trust\n9876543210,100`), "number_only", NOW).ok).toBe(false);
    expect(parseImportCsv(Buffer.from(`${HEADER}\n"unterminated,fraud,2026-09-01,,,,`), "source_observation", NOW).ok).toBe(false);
  });

  it("rejects too many rows", () => {
    const body = Array.from({ length: 50_001 }, () => "9876543210").join("\n");
    expect(parseImportCsv(Buffer.from(`phone_number\n${body}`), "number_only", NOW)).toEqual({ ok: false, error: "TOO_MANY_ROWS" });
  });
});

describe("observationFingerprint", () => {
  const base = { provenanceGroupId: "g1", e164: "+919876543210", category: "fraud" as const, observedAt: new Date("2026-09-01T05:00:00Z") };
  it("uses external id when present, otherwise canonical fields", () => {
    const a = observationFingerprint({ ...base, externalRecordId: "x1" });
    const b = observationFingerprint({ ...base, externalRecordId: "x1", e164: "+919999999999" });
    expect(a).toBe(b);
    const c = observationFingerprint({ ...base, externalRecordId: null });
    const d = observationFingerprint({ ...base, externalRecordId: null, observedAt: new Date("2026-09-01T23:00:00Z") });
    expect(c).toBe(d);
    expect(observationFingerprint({ ...base, externalRecordId: null, provenanceGroupId: "g2" })).not.toBe(c);
  });
});
