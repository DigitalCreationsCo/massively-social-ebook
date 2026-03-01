import pgPromise from 'pg-promise';
import { IMain, IDatabase } from 'pg-promise';

// Types for our ingestion payload
export interface ReactionEvent {
  reaction_id: string; // BigInt passed as string to avoid JS precision issues
  user_id: string;     // UUID
  target_id: string;   // UUID
  reaction_type: number; // SmallInt
  metadata: Record<string, any>;
  created_at: Date;
}

export class IngestionService {
  private db: IDatabase<any>;
  private pgp: IMain;
  private batch: ReactionEvent[] = [];
  private batchSizeLimit: number = 1000;
  private flushIntervalMs: number = 1000; // 1 second max delay
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing: boolean = false;

  constructor(connectionString: string) {
    this.pgp = pgPromise({
      // Initialization options
      capSQL: true // Capitalize SQL generated
    });
    this.db = this.pgp(connectionString);

    // Start the flush timer
    this.startFlushTimer();
  }

  private startFlushTimer() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = setInterval(() => {
      if (this.batch.length > 0) {
        this.flush();
      }
    }, this.flushIntervalMs);
  }

  public async ingest(event: ReactionEvent): Promise<void> {
    this.batch.push(event);

    if (this.batch.length >= this.batchSizeLimit) {
      await this.flush();
    }
  }

  // Public method to force flush (e.g., on shutdown)
  public async flush(): Promise<void> {
    if (this.isFlushing || this.batch.length === 0) return;

    this.isFlushing = true;
    const currentBatch = [...this.batch];
    this.batch = []; // Clear immediate buffer

    const startTime = Date.now();

    try {
      await this.flushToPostgres(currentBatch);
      
      const duration = Date.now() - startTime;
      console.log(`[Ingestion] Flushed ${currentBatch.length} events in ${duration}ms. Rate: ${Math.round(currentBatch.length / (duration / 1000))} events/sec`);
      
    } catch (error) {
      console.error('[Ingestion] Batch flush failed. Initiating DLO protocol.', error);
      await this.handleFailedBatch(currentBatch, error);
    } finally {
      this.isFlushing = false;
      // If more events arrived while flushing, schedule immediate next flush
      if (this.batch.length >= this.batchSizeLimit) {
        setImmediate(() => this.flush());
      }
    }
  }

  private async flushToPostgres(events: ReactionEvent[]): Promise<void> {
    if (events.length === 0) return;

    // Utilize pg-promise helpers for high-performance insert
    // creating a ColumnSet for bulk updates
    const cs = new this.pgp.helpers.ColumnSet([
      'reaction_id', 
      'user_id', 
      'target_id', 
      'reaction_type', 
      {name: 'metadata', mod: ':json'},
      'created_at'
    ], {table: 'reactions'});

    // Generates: INSERT INTO "reactions" (...) VALUES ...
    const query = this.pgp.helpers.insert(events, cs);

    await this.db.none(query);
  }

  private async handleFailedBatch(events: ReactionEvent[], error: any): Promise<void> {
    // Dead Letter Office (DLO) Logic
    try {
      const batchId = crypto.randomUUID();
      const payload = JSON.stringify(events);
      const errorMessage = error instanceof Error ? error.message : String(error);

      await this.db.none(
        'INSERT INTO failed_ingestion_log (batch_id, error_message, payload, status) VALUES ($1, $2, $3, $4)',
        [batchId, errorMessage, payload, 'pending']
      );
      
      console.log(`[Ingestion] Batch ${batchId} moved to DLO.`);
    } catch (dloError) {
      // Catastrophic failure - DLO is down too. Log to stderr/file.
      console.error('[Ingestion] CRITICAL: DLO FAILED. DATA LOSS RISK.', dloError);
      // In production, this might trigger a pager duty alert or write to a local disk file as last resort.
    }
  }

  public async shutdown(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flush();
    await this.pgp.end();
  }
}

// Singleton instance export if needed, or factory
export const createIngestionService = () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
  return new IngestionService(process.env.DATABASE_URL);
};
