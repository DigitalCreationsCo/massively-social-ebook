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

  query_timeout: 70000,
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

// ── Pool Starvation Monitor ──────────────────────────────────────────────
// Logs a warning whenever requests queue up waiting for a connection.
// This surfaces pool-exhaustion bugs before they cause 6s+ request delays.
const POOL_WARN_THRESHOLD = 2; // warn when 2+ requests are queued
let poolStarvationWarned = false;

setInterval(() => {
  const waiting = pool.waitingCount;
  if (waiting >= POOL_WARN_THRESHOLD) {
    if (!poolStarvationWarned) {
      console.warn(
        `[DB POOL] Connection starvation detected: ${waiting} request(s) queued. ` +
          `Total: ${pool.totalCount}, Idle: ${pool.idleCount}. ` +
          `Consider increasing pool.max or reducing concurrent DB work.`,
      );
      poolStarvationWarned = true;
    }
  } else {
    poolStarvationWarned = false;
  }
}, 5000);

// Also log whenever a new connection is created or destroyed
pool.on("connect", () => {
  console.log(
    `[DB POOL] New connection. Total: ${pool.totalCount}, Idle: ${pool.idleCount}, Waiting: ${pool.waitingCount}`,
  );
});
pool.on("acquire", () => {
  if (pool.waitingCount > 0) {
    console.log(
      `[DB POOL] Connection acquired (${pool.waitingCount} still waiting). Total: ${pool.totalCount}, Idle: ${pool.idleCount}`,
    );
  }
});
