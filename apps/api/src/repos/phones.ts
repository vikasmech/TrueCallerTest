import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { phoneNumbers } from "../db/schema.js";
import type { PhoneCrypto } from "../crypto.js";

export type PhoneRow = typeof phoneNumbers.$inferSelect;

export async function findPhoneByE164(db: Db, crypto: PhoneCrypto, e164: string) {
  const key = crypto.lookupKey(e164);
  const rows = await db.select().from(phoneNumbers).where(eq(phoneNumbers.lookupKey, key)).limit(1);
  return rows[0] ?? null;
}

export async function findOrCreatePhone(db: Db, crypto: PhoneCrypto, e164: string): Promise<PhoneRow> {
  const key = crypto.lookupKey(e164);
  const inserted = await db
    .insert(phoneNumbers)
    .values({ lookupKey: key, encryptedE164: crypto.encryptE164(e164), keyVersion: crypto.keyVersion })
    .onConflictDoNothing({ target: phoneNumbers.lookupKey })
    .returning();
  if (inserted[0]) return inserted[0];
  const rows = await db.select().from(phoneNumbers).where(eq(phoneNumbers.lookupKey, key)).limit(1);
  if (!rows[0]) throw new Error("phone upsert race: row missing after conflict");
  return rows[0];
}
