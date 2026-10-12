// Synthetic development seed. Refuses to run in production.
import { eq } from "drizzle-orm";
import { loadEnv } from "../env.js";
import { createDb, createPool } from "./client.js";
import { createPhoneCrypto } from "../crypto.js";
import { findOrCreatePhone } from "../repos/phones.js";
import { recomputeReputation } from "../services/recompute.js";
import { reporterQuality, reports, users } from "./schema.js";

const env = loadEnv();
if (env.NODE_ENV === "production") throw new Error("refusing to seed production");

const pool = createPool(env.DATABASE_URL);
const db = createDb(pool);
const crypto = createPhoneCrypto({
  hmacKeyHex: env.PHONE_HMAC_KEY,
  encKeyHex: env.PHONE_ENC_KEY,
  keyVersion: env.PHONE_KEY_VERSION,
});

const DAY = 86_400_000;
const now = Date.now();

async function user(email: string, tier: "new_verified" | "established" | "reviewed_valid_history") {
  const [u] = await db
    .insert(users)
    .values({ email, verifiedContact: true })
    .onConflictDoUpdate({ target: users.email, set: { verifiedContact: true } })
    .returning();
  await db
    .insert(reporterQuality)
    .values({ reporterId: u!.id, qualityTier: tier, policyVersion: "v1" })
    .onConflictDoUpdate({ target: reporterQuality.reporterId, set: { qualityTier: tier } });
  return u!;
}

const reporters = await Promise.all(
  Array.from({ length: 12 }, (_, i) =>
    user(`seed-reporter-${i}@example.test`, i < 6 ? "reviewed_valid_history" : i < 9 ? "established" : "new_verified"),
  ),
);

// Synthetic, non-allocated-looking test numbers; purely illustrative.
const strong = "+919000000001";
const some = "+919000000002";
const spamOnly = "+919000000003";

async function seedReports(e164: string, category: "fraud" | "spam", n: number, daysSpread: number) {
  const phone = await findOrCreatePhone(db, crypto, e164);
  for (let i = 0; i < n; i++) {
    const r = reporters[i % reporters.length]!;
    await db
      .insert(reports)
      .values({
        phoneId: phone.id,
        reporterId: r.id,
        idempotencyKey: `seed-${e164}-${category}-${i}`,
        channel: i % 2 ? "call" : "sms",
        category,
        eventAt: new Date(now - (i % daysSpread) * DAY),
        status: "accepted",
        reputationEpoch: phone.reputationEpoch,
      })
      .onConflictDoNothing();
  }
  await recomputeReputation(db, phone.id);
  return phone.id;
}

await seedReports(strong, "fraud", 12, 20);
await seedReports(some, "fraud", 3, 10);
await seedReports(spamOnly, "spam", 6, 30);

const [u] = await db.select().from(users).where(eq(users.email, reporters[0]!.email));
console.log(`seeded ${reporters.length} reporters; try lookups for ${strong}, ${some}, ${spamOnly}; sample user ${u?.email}`);
await pool.end();
