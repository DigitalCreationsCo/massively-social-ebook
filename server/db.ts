import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}
console.log("Connecting to DB with URL:", process.env.DATABASE_URL?.substring(0, 30));

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  query_timeout: 15000, // 15 second timeout for queries to prevent connection pool exhaustion
  connectionTimeoutMillis: 10000, // 10 second connection timeout
});
export const db = drizzle({ client: pool, schema });