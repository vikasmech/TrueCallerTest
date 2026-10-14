import { and, eq, isNull, lte } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { importBatches } from "../db/schema.js";
import type { StorageProvider } from "../storage/provider.js";

/** A failed deletion stays eligible for the next scheduled pass. */
export async function expireStagingFiles(
  db: Db,
  storage: StorageProvider,
  onFailure: (batchId: string) => void,
  now = new Date(),
): Promise<{ deleted: number; failed: number }> {
  const expired = await db.select({ id: importBatches.id, objectKey: importBatches.objectKey })
    .from(importBatches)
    .where(and(lte(importBatches.stagingExpiresAt, now), isNull(importBatches.stagingDeletedAt)))
    .limit(100);
  let deleted = 0;
  let failed = 0;
  for (const batch of expired) {
    try {
      await storage.deleteObject(batch.objectKey);
      await db.update(importBatches).set({ stagingDeletedAt: now }).where(eq(importBatches.id, batch.id));
      deleted++;
    } catch {
      failed++;
      // Do not log storage-provider errors that might contain signed URLs or secrets.
      onFailure(batch.id);
    }
  }
  return { deleted, failed };
}
