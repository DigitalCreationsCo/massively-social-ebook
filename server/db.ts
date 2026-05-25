import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { relations } from "@shared/relations";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}
console.log(
  "Connecting to DB with URL:",
  process.env.DATABASE_URL?.substring(0, 30),
);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: false }
      : undefined,

  query_timeout: 15000,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10,
  allowExitOnIdle: true,
  keepAlive: true,
});

// Handle connection errors gracefully - Supabase pooler can terminate connections
pool.on("error", (err) => {
  console.error("[DB] Unexpected pool error, will reconnect:", err.message);
});

// Handle connection terminations from the pooler
pool.on("remove", () => {
  console.log("[DB] Connection removed from pool");
});

export const db = drizzle({ client: pool, schema, relations });
