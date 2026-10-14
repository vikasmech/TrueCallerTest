import type { Role } from "@phone-rep/shared";

/** Allowlists are authoritative, including for sessions issued before a role removal. */
export function roleForEmail(
  email: string,
  config: { ADMIN_EMAILS: readonly string[]; MODERATOR_EMAILS: readonly string[] },
): Role {
  const normalized = email.trim().toLowerCase();
  if (config.ADMIN_EMAILS.includes(normalized)) return "admin";
  if (config.MODERATOR_EMAILS.includes(normalized)) return "moderator";
  return "user";
}
