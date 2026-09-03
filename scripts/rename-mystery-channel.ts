#!/usr/bin/env tsx
/**
 * Rename 'mystery' channel -> 'nap://25th-chapter' (data migration).
 *
 * Usage:
 *   # Dry run against LOCAL dev DB (.env.local -> 127.0.0.1:54322):
 *   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/rename-mystery-channel.ts --dry-run
 *
 *   # Apply to LOCAL dev DB:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/rename-mystery-channel.ts --apply
 *
 *   # Apply to PROD (explicit, separate confirmation required):
 *   DOTENV_CONFIG_PATH=.env.production.local npx tsx scripts/rename-mystery-channel.ts --apply
 *
 * The script:
 *  1. Prints BEFORE counts for 'mystery' vs 'nap://25th-chapter' per table.
 *  2. In --apply mode, runs the rename in a single transaction.
 *  3. Prints AFTER counts and verifies zero 'mystery' rows remain.
 */
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import pg from "pg";

const OLD_ID = "mystery";
const NEW_ID = "nap://25th-chapter";
const TABLES = [
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

const { Pool } = pg;

async function counts(pool: pg.Pool, id: string) {
  const out: Record<string, number> = {};
  for (const t of TABLES) {
    const r = await pool.query(`SELECT COUNT(*)::int AS cnt FROM "${t}" WHERE "channel_id" = $1`, [id]);
    out[t] = r.rows[0].cnt;
  }
  return out;
}

async function main() {
  const mode = process.argv.includes("--apply") ? "apply" : "dry-run";
  const dbUrl = process.env.DATABASE_URL || "";
  const maskedHost = dbUrl.includes("@") ? dbUrl.split("@")[1].split("/")[0] : "(unknown host)";
  console.log(`Mode: ${mode}`);
  console.log(`DB host: ${maskedHost}`);
  console.log(`Rename: '${OLD_ID}' -> '${NEW_ID}'`);

  if (mode === "apply" && maskedHost.includes("pooler.supabase.com")) {
    console.log("⚠️  Target looks like PRODUCTION (supabase pooler).");
    if (!process.argv.includes("--i-know-this-is-prod")) {
      console.error("Refusing to run against prod without --i-know-this-is-prod flag. Aborting.");
      process.exit(1);
    }
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });

  try {
    console.log("\n── BEFORE ──");
    const beforeOld = await counts(pool, OLD_ID);
    const beforeNew = await counts(pool, NEW_ID);
    for (const t of TABLES) {
      console.log(`${t}: mystery=${beforeOld[t]} nap=${beforeNew[t]}`);
    }

    if (beforeOld["channels"] === 0 && beforeNew["channels"] >= 1) {
      console.log("\nAlready renamed (channels has nap id, no mystery row). Nothing to do.");
      return;
    }
    if (beforeOld["channels"] === 0) {
      console.log("\nNo 'mystery' channel row found. Nothing to do.");
      return;
    }
    if (beforeNew["channels"] >= 1) {
      console.error("\nBoth 'mystery' AND 'nap://25th-chapter' exist in channels — manual merge needed. Aborting.");
      process.exit(1);
    }

    if (mode === "dry-run") {
      console.log("\nDry run: would update parent channels row (cascades to children) + safety updates on 9 child tables.");
      console.log("Re-run with --apply to execute.");
      return;
    }

    // ── Apply in transaction ──
    const migrationPath = path.join(process.cwd(), "migrations/20260903050000_rename_mystery_channel_to_nap/migration.sql");
    let sql = fs.readFileSync(migrationPath, "utf8");
    // Strip drizzle statement-breakpoint markers, split into statements
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const stmt of statements) {
        const res = await client.query(stmt);
        console.log(`  rows affected: ${res.rowCount} :: ${stmt.slice(0, 70)}...`);
      }
      await client.query("COMMIT");
      console.log("Transaction COMMITTED.");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    console.log("\n── AFTER ──");
    const afterOld = await counts(pool, OLD_ID);
    const afterNew = await counts(pool, NEW_ID);
    for (const t of TABLES) {
      console.log(`${t}: mystery=${afterOld[t]} nap=${afterNew[t]}`);
    }
    const remaining = Object.values(afterOld).reduce((a, b) => a + b, 0);
    if (remaining === 0) console.log("\n✅ Verified: zero 'mystery' rows remain.");
    else {
      console.error(`\n❌ ${remaining} 'mystery' rows still remain — investigate.`);
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
