import { db } from "./db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export class PartitionManager {
  /**
   * Ensures that the time-series partitions for the current and next N weeks exist.
   * Safe to run concurrently across multiple server instances via pg_advisory_lock.
   */
  static async initializePartitions(weeksAhead = 2) {
    logger.info("Checking and provisioning database partitions...", "partition-manager");

    // Acquire advisory lock using a static integer ID
    // 20261111 is an arbitrary integer acting as our lock identifier
    const lockId = 20261111;
    const lockQuery = sql`SELECT pg_advisory_lock(${lockId})`;
    const unlockQuery = sql`SELECT pg_advisory_unlock(${lockId})`;

    try {
      await db.execute(lockQuery);
      
      const tables = ['blocks', 'votes', 'chat'];
      const today = new Date();
      
      // Pre-provision for this week and future weeks
      for (let i = 0; i <= weeksAhead; i++) {
        // Calculate start of the week (Sunday)
        const targetDate = new Date(today);
        targetDate.setUTCDate(today.getUTCDate() + (i * 7) - today.getUTCDay());
        targetDate.setUTCHours(0, 0, 0, 0);
        
        const nextWeek = new Date(targetDate);
        nextWeek.setUTCDate(targetDate.getUTCDate() + 7);

        // Create a deterministic partition name: e.g., blocks_y2026m03d08
        const y = targetDate.getUTCFullYear();
        const m = String(targetDate.getUTCMonth() + 1).padStart(2, '0');
        const d = String(targetDate.getUTCDate()).padStart(2, '0');
        const partitionSuffix = `y${y}m${m}d${d}`;

        for (const table of tables) {
          const partitionName = `${table}_${partitionSuffix}`;
          const startStr = targetDate.toISOString();
          const endStr = nextWeek.toISOString();

          const createPartitionSql = sql.raw(`
            CREATE TABLE IF NOT EXISTS ${partitionName} 
            PARTITION OF ${table} 
            FOR VALUES FROM ('${startStr}') TO ('${endStr}');
          `);

          await db.execute(createPartitionSql);
        }
      }
      logger.info("Provisioning complete.", "partition-manager");
    } catch (error) {
      logger.error("Error provisioning partitions", "partition-manager", error instanceof Error ? error : new Error(String(error)));
    } finally {
      // Always release the lock
      await db.execute(unlockQuery);
    }
  }
}
