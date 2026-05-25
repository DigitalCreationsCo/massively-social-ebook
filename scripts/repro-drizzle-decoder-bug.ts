/**
 * Reproduction script for Drizzle ORM v1 beta decoder bug
 *
 * Shows that `db.query.blocks.findMany()` with `asc(column)` in `orderBy`
 * generates SQL containing spurious internal-property column references
 * ("decoder", "usedTables", "queryChunks") in the ORDER BY clause.
 *
 * Run: npx tsx scripts/repro-drizzle-decoder-bug.ts
 */

import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../shared/schema";
import { relations } from "../shared/relations";
import { eq, asc } from "drizzle-orm";

function main() {
  console.log("=== Drizzle v1 Beta Decoder Bug Reproduction ===\n");

  // Create a mock drizzle instance — no real database needed for toSQL()
  const db = (drizzle as any).mock({
    schema,
    relations,
  });

  // ── 1. Relational query API (BUGGY) ────────────────────────────────
  console.log("─── 1. db.query.blocks.findMany() (relational API) ───");

  try {
    const buggyQuery = (db.query.blocks as any).findMany({
      columns: { embedding: false, searchVector: false },
      where: (table: any, ops: any) => ops.eq(table.sessionId, 1),
      orderBy: asc(schema.blocks.createdAt),
      limit: 100,
    });

    const buggySql = buggyQuery.toSQL();
    console.log("SQL:    ", buggySql.sql);
    console.log("Params: ", buggySql.params);

    if (buggySql.sql.includes("decoder")) {
      console.log(
        "\n❌ BUG REPRODUCED: ORDER BY references internal properties:",
      );
      console.log("     \"d0\".\"decoder\" — does not exist in the table");
      console.log("     \"d0\".\"usedTables\" — internal SQL property");
      console.log(
        '     "d0"."queryChunks" — internal SQL property\n',
      );
      console.log(
        "   PostgreSQL rejects this with: column d0.decoder does not exist\n",
      );
    } else {
      console.log("\n✅ No 'decoder' reference found (bug not present)\n");
    }
  } catch (err: any) {
    console.log("Error from relational query API:", err.message);
    if (err.stack) console.log(err.stack.split("\n").slice(0, 5).join("\n"));
    console.log(
      "\n⚠️  The relational query API threw before generating SQL.\n",
    );
  }

  // ── 2. Relational API with function-style orderBy (workaround) ─────
  console.log(
    "\n─── 2. db.query.blocks.findMany() with function orderBy (workaround) ───",
  );

  try {
    const workaroundQuery = (db.query.blocks as any).findMany({
      columns: { embedding: false, searchVector: false },
      where: (table: any, ops: any) => ops.eq(table.sessionId, 1),
      orderBy: (table: any, ops: any) => ops.asc(table.createdAt),
      limit: 100,
    });

    const workaroundSql = workaroundQuery.toSQL();
    console.log("SQL:    ", workaroundSql.sql);
    console.log("Params: ", workaroundSql.params);

    if (workaroundSql.sql.includes("decoder")) {
      console.log("\n❌ Function-style orderBy still has the bug\n");
    } else {
      console.log("\n✅ Function-style orderBy works correctly\n");
    }
  } catch (err: any) {
    console.log("Error:", err.message);
  }

  // ── 3. Standard select API (CLEAN) ─────────────────────────────────
  console.log("\n─── 3. db.select().from(blocks) (standard API) ───");

  try {
    const cleanQuery = db
      .select()
      .from(schema.blocks)
      .where(eq(schema.blocks.sessionId, 1))
      .orderBy(asc(schema.blocks.createdAt))
      .limit(100);

    const cleanSql = cleanQuery.toSQL();
    console.log("SQL:    ", cleanSql.sql);
    console.log("Params: ", cleanSql.params);

    if (cleanSql.sql.includes("decoder")) {
      console.log(
        "\n❌ Unexpected 'decoder' reference in standard API SQL!\n",
      );
    } else {
      console.log("\n✅ Clean SQL — no 'decoder' reference\n");
    }
  } catch (err: any) {
    console.log("Error from standard API:", err.message);
  }

  // ── 4. Summary ─────────────────────────────────────────────────────
  console.log("\n─── BUG DESCRIPTION ───────────────────────────────────────");
  console.log(
    "Title:  ORDER BY in db.query.findMany() generates non-existent column refs\n",
  );
  console.log(
    "Drizzle version: ^1.0.0-beta.12-a5629fb (drizzle-orm v1 beta)\n",
  );
  console.log(
    "Trigger: Passing `asc(schema.blocks.createdAt)` (a pre-computed SQL",
  );
  console.log(
    "  expression) to the `orderBy` option of `db.query.blocks.findMany()`.",
  );
  console.log(
    "  The relational query API's `relationsOrderToSQL` function does not",
  );
  console.log(
    '  properly handle SQL expression objects and instead iterates their',
  );
  console.log(
    "  internal properties (decoder, usedTables, queryChunks) as if they",
  );
  console.log("  were column references.\n");
  console.log(
    "Effect: PostgreSQL rejects the query with: column d0.decoder does not exist\n",
  );
  console.log("Workaround: Pass orderBy as a callback:");
  console.log("  orderBy: (table, ops) => ops.asc(table.createdAt)\n");
  console.log("Permanent fix: Use db.select().from(table) instead:");
  console.log("  db.select()");
  console.log("    .from(blocks)");
  console.log("    .where(eq(blocks.sessionId, sessionId))");
  console.log("    .orderBy(asc(blocks.createdAt))");
  console.log("    .limit(100)\n");
  console.log(
    "Applied in: server/storage.ts getReplayBlocks()\n",
  );
}

main();
