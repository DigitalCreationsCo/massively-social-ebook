/**
 * Data Migration: Lift all base64-encoded images from the database to GCS.
 *
 * Scan all rows in `channels`, `blocks`, and `pending_blocks` that have
 * base64 data URIs in their image columns, upload each image to Google
 * Cloud Storage, and patch the row with the public HTTPS URL.
 *
 * Usage:
 *   tsx scripts/migrate-images-to-gcs.ts
 *
 * Environment variables required:
 *   DATABASE_URL        – Postgres connection string
 *   GOOGLE_CLOUD_PROJECT – GCP project ID
 *   GOOGLE_CLOUD_BUCKET  – GCS bucket name
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { GCPStorageManager } from "../server/storage-manager";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DATA_URI_RE = /^data:(image\/\w+);base64,(.+)$/;
const BATCH_SIZE = 50;

/**
 * Strips the `data:image/...;base64,` prefix and returns the raw payload +
 * MIME type.  Returns `null` if the string is not a base64 data URI.
 */
function parseDataUri(
  value: string | null | undefined,
): { base64: string; mimeType: string } | null {
  if (!value) return null;
  const m = value.match(DATA_URI_RE);
  if (!m) return null;
  return { base64: m[2]!, mimeType: m[1]! };
}

/**
 * Builds a deterministic GCS path for migrated images so they follow the same
 * convention as newly generated images (see image-uploader.ts).
 *
 * Pattern: `channels/{channelId}/images/{folder}/{prefix}-{rowId}.{ext}`
 */
function buildMigratedPath(
  channelId: string,
  rowId: number | string,
  folder: "cover" | "blocks" | "pending",
): string {
  return `channels/${channelId}/images/${folder}/migrated-${rowId}.jpg`;
}

// ---------------------------------------------------------------------------
// Table scanners
// ---------------------------------------------------------------------------

async function migrateChannels(gcs: GCPStorageManager): Promise<number> {
  let count = 0;
  let cursor = 0;

  while (true) {
    const { rows } = await db.execute<{
      id: number;
      channel_id: string;
      cover_image: string | null;
    }>(sql`
      SELECT id, channel_id, cover_image
      FROM channels
      WHERE cover_image IS NOT NULL
        AND id > ${cursor}
      ORDER BY id ASC
      LIMIT ${BATCH_SIZE}
    `);

    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;

    console.debug(`  [channels] batch: ids ${rows[0]!.id}–${cursor}`);

    for (const row of rows) {
      const parsed = parseDataUri(row.cover_image);
      if (!parsed) continue; // already a URL or null

      try {
        const path = buildMigratedPath(row.channel_id, row.id, "cover");
        const gsUri = await gcs.uploadBase64Image(
          parsed.base64,
          path,
          parsed.mimeType,
        );
        const publicUrl = gcs.getPublicUrl(gsUri);

        await db.execute(
          sql`UPDATE channels SET cover_image = ${publicUrl} WHERE id = ${row.id}`,
        );
        console.log(
          `  [OK] channels id=${row.id} -> ${publicUrl.substring(0, 100)}...`,
        );
        count++;
      } catch (err) {
        console.error(
          `  [FAIL] channels id=${row.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  return count;
}

async function migrateBlocks(gcs: GCPStorageManager): Promise<number> {
  let count = 0;
  let cursor = 0;

  while (true) {
    const { rows } = await db.execute<{
      id: number;
      channel_id: string;
      image_url: string | null;
    }>(sql`
      SELECT b.id, b.channel_id, b.image_url
      FROM blocks b
      WHERE b.image_url IS NOT NULL
        AND b.id > ${cursor}
      ORDER BY b.id ASC
      LIMIT ${BATCH_SIZE}
    `);

    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;

    console.debug(`  [blocks] batch: ids ${rows[0]!.id}–${cursor}`);

    for (const row of rows) {
      const parsed = parseDataUri(row.image_url);
      if (!parsed) continue;

      try {
        const path = buildMigratedPath(row.channel_id, row.id, "blocks");
        const gsUri = await gcs.uploadBase64Image(
          parsed.base64,
          path,
          parsed.mimeType,
        );
        const publicUrl = gcs.getPublicUrl(gsUri);

        await db.execute(
          sql`UPDATE blocks SET image_url = ${publicUrl} WHERE id = ${row.id}`,
        );
        console.log(
          `  [OK] blocks id=${row.id} -> ${publicUrl.substring(0, 100)}...`,
        );
        count++;
      } catch (err) {
        console.error(
          `  [FAIL] blocks id=${row.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  return count;
}

async function migratePendingBlocks(gcs: GCPStorageManager): Promise<number> {
  let count = 0;
  let cursor = 0;

  while (true) {
    const { rows } = await db.execute<{
      id: number;
      channel_id: string;
      image_url: string;
    }>(sql`
      SELECT pb.id, pb.channel_id, pb.image_url
      FROM pending_blocks pb
      WHERE pb.image_url IS NOT NULL
        AND pb.id > ${cursor}
      ORDER BY pb.id ASC
      LIMIT ${BATCH_SIZE}
    `);

    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;

    console.debug(`  [pending_blocks] batch: ids ${rows[0]!.id}–${cursor}`);

    for (const row of rows) {
      const parsed = parseDataUri(row.image_url);
      if (!parsed) continue;

      try {
        const path = buildMigratedPath(row.channel_id, row.id, "pending");
        const gsUri = await gcs.uploadBase64Image(
          parsed.base64,
          path,
          parsed.mimeType,
        );
        const publicUrl = gcs.getPublicUrl(gsUri);

        await db.execute(
          sql`UPDATE pending_blocks SET image_url = ${publicUrl} WHERE id = ${row.id}`,
        );
        console.log(
          `  [OK] pending_blocks id=${row.id} -> ${publicUrl.substring(0, 100)}...`,
        );
        count++;
      } catch (err) {
        console.error(
          `  [FAIL] pending_blocks id=${row.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const bucket = process.env.GOOGLE_CLOUD_BUCKET;
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || "";

  if (!bucket) {
    console.error(
      "ERROR: GOOGLE_CLOUD_BUCKET environment variable is required.",
    );
    process.exit(1);
  }

  console.log("Initialising GCPStorageManager...");
  const gcs = new GCPStorageManager(projectId, bucket);

  console.log("\n── Scanning channels.cover_image ──");
  const channelsDone = await migrateChannels(gcs);

  console.log("\n── Scanning blocks.image_url ──");
  const blocksDone = await migrateBlocks(gcs);

  console.log("\n── Scanning pending_blocks.image_url ──");
  const pendingDone = await migratePendingBlocks(gcs);

  const total = channelsDone + blocksDone + pendingDone;
  console.log(`\n✅ Migration complete. ${total} images migrated.`);
  console.log(`   channels:       ${channelsDone}`);
  console.log(`   blocks:         ${blocksDone}`);
  console.log(`   pending_blocks: ${pendingDone}`);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
