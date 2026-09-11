#!/usr/bin/env tsx
/**
 * Safely rename one persisted channel key.
 *
 * Usage (dry run is the default):
 *   DOTENV_CONFIG_PATH=.env.local npm run migrate:channel-id -- --from px://25th-chapter --to 25th-chapter
 *
 * Apply after reviewing the counts:
 *   DOTENV_CONFIG_PATH=.env.local npm run migrate:channel-id -- --from px://25th-chapter --to 25th-chapter --apply
 *
 * For production, add --i-know-this-is-prod. Stop the affected broadcast
 * first: remote staged slots are deliberately not mutated by this database
 * migration, and persisted receipts are cleared for safe re-staging.
 */
import * as dotenv from "dotenv";
import pg from "pg";

import { isSafeChannelId } from "../shared/channel-id";

const CHANNEL_TABLES = [
  "channels",
  "channel_states",
  "schedules",
  "sessions",
  "blocks",
  "pending_blocks",
  "lore",
  "votes",
  "chat",
  "reactions",
] as const;

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local", override: true });

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value?.trim() || undefined;
}

async function channelCounts(pool: pg.Pool, channelId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of CHANNEL_TABLES) {
    const result = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM "${table}" WHERE channel_id = $1`,
      [channelId],
    );
    counts[table] = result.rows[0]!.count;
  }
  return counts;
}

async function broadcastSettingCount(pool: pg.Pool, channelId: string): Promise<number> {
  const result = await pool.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM system_settings WHERE key LIKE $1",
    [`broadcast:${channelId}:%`],
  );
  return result.rows[0]!.count;
}

function printCounts(label: string, counts: Record<string, number>, settingCount: number): void {
  console.log(`\n── ${label} ──`);
  for (const table of CHANNEL_TABLES) console.log(`${table}: ${counts[table]}`);
  console.log(`broadcast system settings: ${settingCount}`);
}

async function main(): Promise<void> {
  const from = argument("--from");
  const to = argument("--to");
  const apply = process.argv.includes("--apply");
  if (!from || !to) {
    throw new Error("Usage: npm run migrate:channel-id -- --from <legacy-id> --to <safe-id> [--apply]");
  }
  if (from === to) throw new Error("--from and --to must differ");
  if (!isSafeChannelId(to)) {
    throw new Error("--to must be URL-path-safe: letters, digits, dots, underscores, and hyphens only");
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const targetHost = databaseUrl.includes("@") ? databaseUrl.split("@")[1]!.split("/")[0]! : "(unknown host)";
  if (apply && targetHost.includes("pooler.supabase.com") && !process.argv.includes("--i-know-this-is-prod")) {
    throw new Error("Refusing production migration without --i-know-this-is-prod");
  }

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
  try {
    const beforeSource = await channelCounts(pool, from);
    const beforeTarget = await channelCounts(pool, to);
    const sourceSettings = await broadcastSettingCount(pool, from);
    const targetSettings = await broadcastSettingCount(pool, to);
    printCounts(`BEFORE (${from})`, beforeSource, sourceSettings);
    printCounts(`BEFORE (${to})`, beforeTarget, targetSettings);

    if (beforeSource.channels === 0 && beforeTarget.channels > 0) {
      console.log("\nAlready migrated; no changes made.");
      return;
    }
    if (beforeSource.channels === 0) {
      console.log("\nSource channel does not exist; no changes made.");
      return;
    }
    if (beforeTarget.channels > 0) {
      throw new Error("Both source and target channel rows exist; resolve that data collision manually.");
    }
    if (!apply) {
      console.log("\nDry run only. Re-run with --apply after stopping the affected broadcast.");
      return;
    }

    const sourcePrefix = `broadcast:${from}:`;
    const targetPrefix = `broadcast:${to}:`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const conflicts = await client.query<{ key: string }>(
        `SELECT legacy.key
         FROM system_settings legacy
         JOIN system_settings target
           ON target.key = $2 || substring(legacy.key FROM char_length($1) + 1)
         WHERE legacy.key LIKE $1 || '%'`,
        [sourcePrefix, targetPrefix],
      );
      if (conflicts.rowCount) {
        throw new Error(`Broadcast-setting collision at ${conflicts.rows[0]!.key}`);
      }

      await client.query("UPDATE channels SET channel_id = $2 WHERE channel_id = $1", [from, to]);
      await client.query(
        `UPDATE system_settings
         SET key = $2 || substring(key FROM char_length($1) + 1)
         WHERE key LIKE $1 || '%'`,
        [sourcePrefix, targetPrefix],
      );
      const cleared = await client.query(
        `UPDATE blocks
         SET delivery_segments = COALESCE(
           (
             SELECT jsonb_agg(
               segment - ARRAY['queuePairId', 'queueIdempotencyKey', 'queueSlotKey', 'queueImageJobId', 'queueAudioJobId']
               ORDER BY ordinal
             )
             FROM jsonb_array_elements(delivery_segments) WITH ORDINALITY AS item(segment, ordinal)
           ),
           '[]'::jsonb
         )
         WHERE channel_id = $1 AND delivery_segments IS NOT NULL`,
        [to],
      );
      await client.query("COMMIT");
      console.log(`\nCommitted channel rename and cleared queue receipts from ${cleared.rowCount ?? 0} block(s).`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const afterSource = await channelCounts(pool, from);
    const afterTarget = await channelCounts(pool, to);
    const afterSourceSettings = await broadcastSettingCount(pool, from);
    const afterTargetSettings = await broadcastSettingCount(pool, to);
    printCounts(`AFTER (${from})`, afterSource, afterSourceSettings);
    printCounts(`AFTER (${to})`, afterTarget, afterTargetSettings);
    if (Object.values(afterSource).some((count) => count > 0) || afterSourceSettings > 0) {
      throw new Error("Migration committed but legacy channel references remain; investigate before restart.");
    }
    console.log("\nVerified: the safe channel ID is ready for broadcast restart.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Channel-ID migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
