# Ingestion Layer Root Cause Analysis (RCA) Framework

This document outlines the framework for identifying and resolving high-performance ingestion failures in the Massively Social Ebook system.

## 1. Primary Failure Modes

| Symptom | Probable Cause | Diagnostic Command / Metric |
|---------|----------------|-----------------------------|
| **High Latency (>50ms)** | Lock Contention | `SELECT * FROM pg_locks WHERE granted = false;` |
| | CPU Saturation | Check Node.js CPU usage & Postgres CPU |
| | Network/Bandwidth | Check network I/O throughput |
| **Ingestion Stalls** | WAL Exhaustion | `SELECT * FROM pg_stat_wal;` (Check if WAL generation > archiving) |
| | Connection Pool Full | `SELECT * FROM pg_stat_activity;` (Check count vs max_connections) |
| **Data Loss / DLO Spikes** | Partition Missing | Check `reactions` table partitions for current date |
| | Schema Mismatch | Verify `failed_ingestion_log` error messages |
| | JSONB Validation | Check application logs for parsing errors |

## 2. Partitioning Failures

**Scenario:** The ingestion service throws "relation "reactions_pYYYYMMDD" does not exist".

**Root Cause:**
- Automatic partition maintenance job failed or didn't run.
- Timezone mismatch between application and database.

**Resolution:**
1. **Immediate Fix:** Manually create the missing partition.
   ```sql
   CREATE TABLE reactions_p20260301 PARTITION OF reactions
   FOR VALUES FROM ('2026-03-01 00:00:00+00') TO ('2026-03-02 00:00:00+00');
   ```
2. **Prevention:** Verify `maintain_partitions()` function is scheduled via `pg_cron` or external scheduler.

## 3. Write-Ahead Log (WAL) Exhaustion

**Scenario:** Database throughput drops to near zero; logs show "checkpoint starting" frequently.

**Root Cause:**
- High ingestion volume (5M+ events/day) generating WAL faster than checkpoints can occur.
- `min_wal_size` / `max_wal_size` too low.

**Resolution:**
- Increase `max_wal_size` (e.g., 4GB -> 16GB).
- Tune `checkpoint_timeout` (increase to 15-30 mins).
- Check disk I/O latency.

## 4. Memory Pressure (Node.js)

**Scenario:** Ingestion Service crashes with OOM (Out Of Memory).

**Root Cause:**
- `batchSizeLimit` too high, accumulating too many objects in memory.
- `flushToPostgres` latency spikes, causing backlog in `batch` array.
- Memory leak in `pg-promise` usage (rare, but possible if connections aren't released).

**Resolution:**
- Reduce `batchSizeLimit` (e.g., 1000 -> 500).
- Implement backpressure: Reject new `ingest()` calls if `batch` length > safety threshold.
- Profile with `node --inspect`.

## 5. Dead Letter Office (DLO) Analysis

**Scenario:** `failed_ingestion_log` is filling up.

**Investigation:**
1. Query the log:
   ```sql
   SELECT error_message, count(*) FROM failed_ingestion_log GROUP BY error_message;
   ```
2. **Common Errors:**
   - `check constraint violation`: Data violates schema (e.g., negative IDs).
   - `syntax error`: Corrupt JSON payload.
   - `connection timeout`: Database overloaded.

**Replay Strategy:**
- For transient errors (timeouts), write a script to read `payload` and call `ingest()` again.
- For data errors, fix the bug in the producer (client/app) and decide whether to discard or patch data.

## 6. Monitoring & Alerts

Ensure the following alerts are configured in your monitoring system (Prometheus/Grafana/Datadog):

- **Ingestion Rate:** Alert if `events/sec` < 10 for > 5 mins (during peak hours).
- **Latency:** Alert if `p99_latency` > 100ms.
- **DLO Growth:** Alert if `failed_ingestion_log` count increases by > 100 in 5 mins.
- **Partition Check:** Alert if tomorrow's partition does not exist by 20:00 UTC today.
