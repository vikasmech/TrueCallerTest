import { parsePhoneNumberWithError, type CountryCode } from "libphonenumber-js/max";

export type NormalizedPhone = {
  e164: string;
  country: CountryCode | undefined;
  type: "mobile" | "fixed_line" | "fixed_line_or_mobile" | "other";
};

export type PhoneNormalizationError = {
  code: "INVALID_NUMBER" | "UNSUPPORTED_TYPE" | "EMPTY";
  message: string;
};

export type NormalizeResult =
  | { ok: true; value: NormalizedPhone }
  | { ok: false; error: PhoneNormalizationError };

const ALLOWED_TYPES = new Set(["MOBILE", "FIXED_LINE", "FIXED_LINE_OR_MOBILE", "VOIP", undefined]);

export function normalizePhone(input: string, defaultRegion: CountryCode = "IN"): NormalizeResult {
  const trimmed = (input ?? "").trim();
  if (!trimmed) {
    return { ok: false, error: { code: "EMPTY", message: "Phone number is required." } };
  }
  try {
    const parsed = parsePhoneNumberWithError(trimmed, defaultRegion);
    if (!parsed.isValid()) {
      return { ok: false, error: { code: "INVALID_NUMBER", message: "Not a valid phone number." } };
    }
    const t = parsed.getType();
    if (!ALLOWED_TYPES.has(t)) {
      return {
        ok: false,
        error: { code: "UNSUPPORTED_TYPE", message: `Unsupported number type: ${t}.` },
      };
    }
    const type: NormalizedPhone["type"] =
      t === "MOBILE"
        ? "mobile"
        : t === "FIXED_LINE"
          ? "fixed_line"
          : t === "FIXED_LINE_OR_MOBILE"
            ? "fixed_line_or_mobile"
            : "other";
    return { ok: true, value: { e164: parsed.number, country: parsed.country, type } };
  } catch {
    return { ok: false, error: { code: "INVALID_NUMBER", message: "Not a valid phone number." } };
  }
}
