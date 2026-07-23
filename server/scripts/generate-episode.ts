#!/usr/bin/env tsx
/**
 * Episode Generation Script — CLI for generating story episodes.
 *
 * Usage:
 *   npx tsx server/scripts/generate-episode.ts --channel <channelId> [--session <sessionId>] [--count <N>] [--dry-run]
 *
 * Options:
 *   --channel     Required. Channel ID to generate blocks for.
 *   --session     Optional. Session ID to generate blocks for. If omitted, uses the next scheduled session.
 *   --count       Number of blocks to generate (default: 20).
 *   --dry-run     If set, generates but does not persist blocks.
 *   --help        Show this help message.
 *
 * Examples:
 *   # Generate 20 blocks for the next scheduled session in "mystery" channel
 *   npx tsx server/scripts/generate-episode.ts --channel mystery
 *
 *   # Generate 15 blocks for session 42 (dry run)
 *   npx tsx server/scripts/generate-episode.ts --channel mystery --session 42 --count 15 --dry-run
 *
 *   # Generate blocks for a specific session and persist them
 *   npx tsx server/scripts/generate-episode.ts --channel mystery --session 42
 */

import { storage } from "../storage";
import { logger } from "../logger";
import { batchGenerateBlocks, getPreviousSessionContext } from "../blocks/batch-generate";

function printHelp(): void {
  console.log(`
Usage:
  npx tsx server/scripts/generate-episode.ts --channel <channelId> [options]

Options:
  --channel       Channel ID (required)
  --session       Session ID (optional; uses next scheduled if omitted)
  --count         Block count (default: 20)
  --dry-run       Generate without persisting (default: false)
  --help          Show this help message

Examples:
  npx tsx server/scripts/generate-episode.ts --channel mystery
  npx tsx server/scripts/generate-episode.ts --channel mystery --session 42 --count 15
  npx tsx server/scripts/generate-episode.ts --channel mystery --session 42 --dry-run
  `);
}

function parseArgs(): {
  channel: string;
  session: number | undefined;
  count: number;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  const getArg = (key: string): string | undefined => {
    const index = args.indexOf(key);
    return index >= 0 ? args[index + 1] : undefined;
  };

  const channel = getArg("--channel");
  const sessionStr = getArg("--session");
  const countStr = getArg("--count");
  const dryRun = args.includes("--dry-run");

  if (!channel) {
    console.error("Error: --channel is required");
    printHelp();
    process.exit(1);
  }

  const count = countStr ? parseInt(countStr, 10) : 20;
  if (isNaN(count) || count < 1) {
    console.error("Error: --count must be a positive integer");
    process.exit(1);
  }

  return {
    channel,
    session: sessionStr ? parseInt(sessionStr, 10) : undefined,
    count,
    dryRun,
  };
}

async function main(): Promise<void> {
  const opts = parseArgs();

  // Validate channel exists
  const channel = await storage.getChannel(opts.channel);
  if (!channel) {
    console.error(`Error: Channel "${opts.channel}" not found`);
    process.exit(1);
  }

  // Determine session ID
  let sessionId: number | undefined = opts.session;

  if (!sessionId) {
    // Find the next scheduled session
    const nextSession = await storage.getNextSession(opts.channel);
    if (!nextSession) {
      console.error(
        `Error: No scheduled session found for channel "${opts.channel}". Use --session to specify a session ID.`,
      );
      process.exit(1);
    }
    sessionId = nextSession.id;
    console.log(`Using next scheduled session: "${nextSession.title}" (id: ${sessionId})`);
  } else {
    // Verify session exists
    const session = await storage.getSessionById(sessionId);
    if (!session) {
      console.error(`Error: Session ${sessionId} not found`);
      process.exit(1);
    }
    console.log(`Using session: "${session.title}" (id: ${sessionId})`);
  }

  // Check if blocks already exist
  const existingBlocks = await storage.getBlocksBySessionOrdered(sessionId);
  if (existingBlocks.length > 0 && !opts.dryRun) {
    console.warn(
      `Warning: Session ${sessionId} already has ${existingBlocks.length} block(s). ` +
        "Use --session with a different session or delete existing blocks first.",
    );
  }

  // Get narrative context from previous session
  const previousContext = await getPreviousSessionContext(opts.channel, sessionId);
  if (previousContext) {
    console.log(`Previous context: "${previousContext.slice(0, 100)}..."`);
  } else {
    console.log("No previous session context found — starting fresh.");
  }

  console.log(`\nStarting batch generation:`);
  console.log(`  Channel:    ${opts.channel}`);
  console.log(`  Session:    ${sessionId}`);
  console.log(`  Block count: ${opts.count}`);
  console.log(`  Dry run:    ${opts.dryRun}`);
  console.log();

  const startTime = Date.now();

  try {
    const result = await batchGenerateBlocks(opts.channel, sessionId, previousContext, {
      blockCount: opts.count,
      dryRun: opts.dryRun,
    });

    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n=== Generation Complete ===`);
    console.log(`  Duration:     ${durationSec}s`);
    console.log(`  Generated:    ${result.blocksGenerated}`);
    console.log(`  Failed:       ${result.blocksFailed}`);
    console.log(`  Persisted:    ${opts.dryRun ? "No (dry run)" : "Yes"}`);

    if (result.errors.length > 0) {
      console.warn(`\nErrors:`);
      result.errors.forEach((err) => console.warn(`  - ${err}`));
    }

    process.exit(result.blocksFailed > 0 ? 1 : 0);
  } catch (err) {
    console.error("\nFatal error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
