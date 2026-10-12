/** Masks an E.164 number for display to its reporter/moderators: +91XXXXXX1234. */
export function maskE164(e164: string): string {
  if (e164.length <= 6) return e164;
  const prefixLen = e164.startsWith("+91") ? 3 : Math.min(3, e164.length - 4);
  const tail = e164.slice(-4);
  const middle = "X".repeat(Math.max(0, e164.length - prefixLen - 4));
  return `${e164.slice(0, prefixLen)}${middle}${tail}`;
}

/** Prefix a leading apostrophe so spreadsheet apps do not evaluate the cell as a formula. */
export function escapeCsvFormula(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = escapeCsvFormula(String(value));
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
