import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type PgBoss from "pg-boss";
import type pg from "pg";
import { csvCell } from "@phone-rep/shared";
import { withTransaction, type Db } from "../db/client.js";
import {
  dataSources,
  importBatches,
  importRows,
  observationBatchLinks,
  phoneNumbers,
  sourceObservations,
  type ImportRowCountsJson,
} from "../db/schema.js";
import type { PhoneCrypto } from "../crypto.js";
import type { StorageProvider } from "../storage/provider.js";
import { enqueueRecompute, txDb } from "../queue.js";
import { observationFingerprint, parseImportCsv } from "./import-parse.js";

export const EMPTY_COUNTS: ImportRowCountsJson = {
  total: 0, valid: 0, invalid: 0, duplicate: 0, stale: 0, excluded: 0,
  newNumbers: 0, existingNumbers: 0, newObservations: 0, duplicateObservations: 0, processed: 0,
};

const CHUNK = 500;

export type ImportDeps = {
  db: Db;
  pool: pg.Pool;
  boss: PgBoss;
  crypto: PhoneCrypto;
  storage: StorageProvider;
};

/** Stage → previewed. Writes normalized rows; has no public effect. */
export async function runImportParse(deps: ImportDeps, batchId: string, now = new Date()): Promise<void> {
  const { db } = deps;
  const [batch] = await db.select().from(importBatches).where(eq(importBatches.id, batchId)).limit(1);
  if (!batch || (batch.state !== "staged" && batch.state !== "parsing")) return;
  const [source] = await db.select().from(dataSources).where(eq(dataSources.id, batch.sourceId)).limit(1);
  if (!source) throw new Error("source missing");

  await db.update(importBatches).set({ state: "parsing" }).where(eq(importBatches.id, batchId));
  // Re-runs after a crash start clean.
  await db.delete(importRows).where(eq(importRows.batchId, batchId));

  const file = await deps.storage.getObject(batch.objectKey);
  const parsed = parseImportCsv(file, batch.mode, now);
  if (!parsed.ok) {
    await db.update(importBatches).set({ state: "parse_failed", error: parsed.error }).where(eq(importBatches.id, batchId));
    return;
  }

  const counts: ImportRowCountsJson = { ...EMPTY_COUNTS, total: parsed.rows.length };
  const seenInFile = new Set<string>();
  const lookupKeys = new Set<string>();

  type Pending = typeof importRows.$inferInsert;
  const pending: Pending[] = parsed.rows.map((r) => {
    const row: Pending = {
      batchId,
      rowNumber: r.rowNumber,
      validationStatus: r.status,
      errorCode: r.errorCode,
      category: r.category,
      observedAt: r.observedAt,
      externalRecordId: r.externalRecordId,
      sourceScore: r.sourceScore,
      sourceScoreScale: r.sourceScoreScale,
      expiresAt: r.expiresAt,
    };
    if (r.e164) {
      row.lookupKey = deps.crypto.lookupKey(r.e164);
      row.e164Encrypted = deps.crypto.encryptE164(r.e164);
      lookupKeys.add(row.lookupKey);
      if (r.status === "valid" && r.category && r.observedAt) {
        const fp = observationFingerprint({
          provenanceGroupId: source.provenanceGroupId,
          externalRecordId: r.externalRecordId,
          e164: r.e164,
          category: r.category,
          observedAt: r.observedAt,
        });
        row.fingerprint = fp;
        if (seenInFile.has(fp)) {
          row.validationStatus = "duplicate";
          row.errorCode = "DUPLICATE_IN_FILE";
        }
        seenInFile.add(fp);
      }
    }
    return row;
  });

  const existingKeys = new Set<string>();
  for (const keys of chunk([...lookupKeys], CHUNK)) {
    const found = await db.select({ k: phoneNumbers.lookupKey }).from(phoneNumbers).where(inArray(phoneNumbers.lookupKey, keys));
    found.forEach((f) => existingKeys.add(f.k));
  }
  const existingFps = new Set<string>();
  for (const fps of chunk([...seenInFile], CHUNK)) {
    const found = await db.select({ f: sourceObservations.fingerprint }).from(sourceObservations).where(inArray(sourceObservations.fingerprint, fps));
    found.forEach((f) => existingFps.add(f.f));
  }

  const countedNumbers = new Set<string>();
  for (const row of pending) {
    counts[row.validationStatus]++;
    if (row.lookupKey && row.validationStatus !== "invalid" && !countedNumbers.has(row.lookupKey)) {
      countedNumbers.add(row.lookupKey);
      existingKeys.has(row.lookupKey) ? counts.existingNumbers++ : counts.newNumbers++;
    }
    if (row.fingerprint && row.validationStatus === "valid") {
      if (existingFps.has(row.fingerprint)) {
        row.validationStatus = "duplicate";
        row.errorCode = "DUPLICATE_OBSERVATION";
        counts.valid--;
        counts.duplicate++;
        counts.duplicateObservations++;
      } else {
        counts.newObservations++;
      }
    }
  }

  for (const rows of chunk(pending, CHUNK)) {
    await db.insert(importRows).values(rows);
  }
  await db.update(importBatches).set({ state: "previewed", rowCounts: counts, error: null }).where(eq(importBatches.id, batchId));
}

/** previewed → committed. Resumable: rows with observation_id / phone_id set are skipped. */
export async function runImportCommit(deps: ImportDeps, batchId: string): Promise<void> {
  const { db, pool, boss } = deps;
  const [batch] = await db.select().from(importBatches).where(eq(importBatches.id, batchId)).limit(1);
  if (!batch || (batch.state !== "committing")) return;
  const [source] = await db.select().from(dataSources).where(eq(dataSources.id, batch.sourceId)).limit(1);
  if (!source || source.reviewStatus !== "approved") {
    await db.update(importBatches).set({ state: "commit_failed", error: "SOURCE_NOT_APPROVED" }).where(eq(importBatches.id, batchId));
    return;
  }

  const touchedPhones = new Set<string>();
  const counts = { ...batch.rowCounts };

  for (;;) {
    const rows = await db
      .select()
      .from(importRows)
      .where(
        and(
          eq(importRows.batchId, batchId),
          inArray(importRows.validationStatus, ["valid", "duplicate"]),
          sql`${importRows.phoneId} is null`,
        ),
      )
      .orderBy(importRows.rowNumber)
      .limit(CHUNK);
    if (!rows.length) break;

    await withTransaction(pool, async (tx, client) => {
      for (const row of rows) {
        if (!row.lookupKey || !row.e164Encrypted) continue;
        const [phone] = await tx
          .insert(phoneNumbers)
          .values({ lookupKey: row.lookupKey, encryptedE164: row.e164Encrypted, keyVersion: deps.crypto.keyVersion })
          .onConflictDoUpdate({ target: phoneNumbers.lookupKey, set: { lookupKey: row.lookupKey } })
          .returning();
        if (!phone) throw new Error("phone upsert failed");

        let observationId: string | null = null;
        if (batch.mode !== "number_only" && row.fingerprint && row.category && row.observedAt) {
          const [obs] = await tx
            .insert(sourceObservations)
            .values({
              phoneId: phone.id,
              sourceId: source.id,
              provenanceGroupId: source.provenanceGroupId,
              externalRecordId: row.externalRecordId,
              category: row.category,
              observedAt: row.observedAt,
              sourceScore: row.sourceScore,
              sourceScoreScale: row.sourceScoreScale,
              expiresAt: row.expiresAt,
              reputationEpoch: phone.reputationEpoch,
              fingerprint: row.fingerprint,
            })
            // Same fingerprint from another batch: reuse and re-activate, do not duplicate.
            .onConflictDoUpdate({ target: sourceObservations.fingerprint, set: { status: "active" } })
            .returning({ id: sourceObservations.id });
          observationId = obs!.id;
          await tx
            .insert(observationBatchLinks)
            .values({ observationId, batchId, active: true })
            .onConflictDoUpdate({ target: [observationBatchLinks.observationId, observationBatchLinks.batchId], set: { active: true } });
          touchedPhones.add(phone.id);
        }

        await tx
          .update(importRows)
          .set({ phoneId: phone.id, observationId })
          .where(and(eq(importRows.batchId, batchId), eq(importRows.rowNumber, row.rowNumber)));
      }
      counts.processed += rows.length;
      await tx.update(importBatches).set({ rowCounts: counts }).where(eq(importBatches.id, batchId));
      for (const phoneId of touchedPhones) await enqueueRecompute(boss, phoneId, { db: txDb(client) });
      touchedPhones.clear();
    });
  }

  await db
    .update(importBatches)
    .set({ state: "committed", committedAt: new Date(), rowCounts: counts })
    .where(eq(importBatches.id, batchId));
}

/** committed → revoked. Observations still linked to another active batch are kept. */
export async function runImportRollback(deps: ImportDeps, batchId: string): Promise<void> {
  const { db, pool, boss } = deps;
  const [batch] = await db.select().from(importBatches).where(eq(importBatches.id, batchId)).limit(1);
  if (!batch || batch.state !== "revoked") return;

  await withTransaction(pool, async (tx, client) => {
    const links = await tx
      .update(observationBatchLinks)
      .set({ active: false })
      .where(and(eq(observationBatchLinks.batchId, batchId), eq(observationBatchLinks.active, true)))
      .returning({ observationId: observationBatchLinks.observationId });
    const obsIds = links.map((l) => l.observationId);
    if (!obsIds.length) return;

    const stillSupported = await tx
      .select({ id: observationBatchLinks.observationId })
      .from(observationBatchLinks)
      .where(and(inArray(observationBatchLinks.observationId, obsIds), eq(observationBatchLinks.active, true)));
    const keep = new Set(stillSupported.map((s) => s.id));
    const revoke = obsIds.filter((id) => !keep.has(id));

    if (revoke.length) {
      const revoked = await tx
        .update(sourceObservations)
        .set({ status: "revoked" })
        .where(inArray(sourceObservations.id, revoke))
        .returning({ phoneId: sourceObservations.phoneId });
      for (const phoneId of new Set(revoked.map((r) => r.phoneId))) {
        await enqueueRecompute(boss, phoneId, { db: txDb(client) });
      }
    }
  });
}

export async function buildRowErrorCsv(db: Db, batchId: string): Promise<string> {
  const rows = await db
    .select({ n: importRows.rowNumber, s: importRows.validationStatus, e: importRows.errorCode })
    .from(importRows)
    .where(and(eq(importRows.batchId, batchId), isNotNull(importRows.errorCode)))
    .orderBy(importRows.rowNumber);
  const lines = ["row_number,status,error_code"];
  for (const r of rows) lines.push([csvCell(r.n), csvCell(r.s), csvCell(r.e)].join(","));
  return lines.join("\r\n") + "\r\n";
}

function* chunk<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}
