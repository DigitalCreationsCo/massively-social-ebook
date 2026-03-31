import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.production.local" });

const runMigration = async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing");

    // Disable prefetch for migrations to avoid connection pinning issues
    const sql = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
    });
    const db = drizzle(sql);

    console.log("⏳ Running migrations...");

    try {
        await migrate(db, { migrationsFolder: "migrations-prod" });
        console.log("✅ Migrations applied successfully!");
    } catch (error) {
        console.error("❌ Migration failed:");
        console.error(error);
        process.exit(1);
    } finally {
        await sql.end();
    }
};

runMigration();