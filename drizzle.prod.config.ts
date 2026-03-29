import { defineConfig } from "drizzle-kit";
import * as dotenv from 'dotenv';
dotenv.config({
  path: '.env.production.local',
  override: true,
});

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations-prod",
  schema: "./shared/schema.ts",
  schemaFilter: "public",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
    ssl: true, // Force SSL for production connectivity
  },
  verbose: true,
});
