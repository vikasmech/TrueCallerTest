import { parse } from "csv-parse/sync";
import { createHash } from "node:crypto";
import { IMPORT_CSV_COLUMNS, IMPORT_LIMITS, normalizePhone, type Category } from "@phone-rep/shared";

export type ParsedRow = {
  rowNumber: number;
  status: "valid" | "invalid" | "stale" | "excluded";
  errorCode: string | null;
  e164: string | null;
  category: Category | null;
  observedAt: Date | null;
  externalRecordId: string | null;
  sourceScore: string | null;
  sourceScoreScale: string | null;
  expiresAt: Date | null;
};

export type ParseOutcome =
  | { ok: true; rows: ParsedRow[] }
  | { ok: false; error: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/;

function parseDate(v: string | undefined): Date | null | "invalid" {
  if (!v) return null;
  if (!ISO_DATE.test(v)) return "invalid";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

/**
 * Strict parse: exact header set, string-only cells (no formula evaluation), bounded rows.
 * `mode` decides which columns are required.
 */
export function parseImportCsv(
  buffer: Buffer,
  mode: "number_only" | "source_observation" | "synthetic_test",
  now: Date,
): ParseOutcome {
  if (buffer.length > IMPORT_LIMITS.maxBytes) return { ok: false, error: "FILE_TOO_LARGE" };

  let records: Record<string, string>[];
  try {
    records = parse(buffer, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: false,
      cast: false,
      to: IMPORT_LIMITS.maxRows + 1,
    }) as Record<string, string>[];
  } catch (e) {
    return { ok: false, error: `CSV_PARSE_ERROR: ${(e as Error).message.slice(0, 200)}` };
  }
  if (records.length > IMPORT_LIMITS.maxRows) return { ok: false, error: "TOO_MANY_ROWS" };

  const header = records[0] ? Object.keys(records[0]) : [];
  if (records.length > 0) {
    const expected = new Set<string>(IMPORT_CSV_COLUMNS);
    const unknown = header.filter((h) => !expected.has(h));
    if (unknown.length || !header.includes("phone_number")) {
      return { ok: false, error: `UNEXPECTED_COLUMNS: ${unknown.join(",") || "missing phone_number"}` };
    }
  }

  const needsObservation = mode !== "number_only";
  const rows: ParsedRow[] = records.map((rec, i) => {
    const rowNumber = i + 2; // header is row 1
    const base: ParsedRow = {
      rowNumber,
      status: "valid",
      errorCode: null,
      e164: null,
      category: null,
      observedAt: null,
      externalRecordId: rec.external_record_id || null,
      sourceScore: null,
      sourceScoreScale: rec.source_score_scale || null,
      expiresAt: null,
    };
    const invalid = (code: string): ParsedRow => ({ ...base, status: "invalid", errorCode: code });

    const norm = normalizePhone(String(rec.phone_number ?? ""));
    if (!norm.ok) return invalid(norm.error.code);
    base.e164 = norm.value.e164;

    if (!needsObservation) {
      return rec.category || rec.observed_at ? { ...base, status: "excluded", errorCode: "OBSERVATION_FIELDS_IGNORED_IN_NUMBER_ONLY" } : base;
    }

    if (rec.category !== "fraud" && rec.category !== "spam") return invalid("INVALID_CATEGORY");
    base.category = rec.category;

    const observed = parseDate(rec.observed_at);
    if (observed === "invalid") return invalid("INVALID_OBSERVED_AT");
    if (observed === null) return invalid("MISSING_OBSERVED_AT");
    if (observed.getTime() > now.getTime()) return invalid("FUTURE_OBSERVED_AT");
    base.observedAt = observed;

    const expires = parseDate(rec.expires_at);
    if (expires === "invalid") return invalid("INVALID_EXPIRES_AT");
    base.expiresAt = expires;
    if (expires && expires.getTime() <= now.getTime()) return { ...base, status: "stale", errorCode: "ALREADY_EXPIRED" };

    if (rec.source_score) {
      if (!/^-?\d+(\.\d+)?$/.test(rec.source_score)) return invalid("INVALID_SOURCE_SCORE");
      if (!rec.source_score_scale) return invalid("MISSING_SOURCE_SCORE_SCALE");
      base.sourceScore = rec.source_score;
    }
    return base;
  });

  return { ok: true, rows };
}

/** Dedup key: provenance + external id when present, else number+category+observed date+provenance. */
export function observationFingerprint(input: {
  provenanceGroupId: string;
  externalRecordId: string | null;
  e164: string;
  category: Category;
  observedAt: Date;
}): string {
  const parts = input.externalRecordId
    ? ["ext", input.provenanceGroupId, input.externalRecordId]
    : ["canon", input.provenanceGroupId, input.e164, input.category, input.observedAt.toISOString().slice(0, 10)];
  return createHash("sha256").update(parts.join("\u0000")).digest("base64url");
}
