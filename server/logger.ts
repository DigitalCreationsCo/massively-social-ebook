import fs from "fs";
import path from "path";

const LOG_DIR = path.join(process.cwd(), "logs");
const isDev = process.env.NODE_ENV !== "production";

// Ensure log directory exists in development
if (isDev && !fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  source?: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

function formatLogEntry(
  level: LogLevel,
  message: string,
  source?: string,
  context?: Record<string, unknown>,
  error?: Error
): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    source,
    context,
  };

  if (error) {
    entry.error = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return entry;
}

function writeToFile(entry: LogEntry): void {
  if (!isDev) return;

  const date = new Date().toISOString().split("T")[0];
  const logFile = path.join(LOG_DIR, `app-${date}.log`);
  const line = JSON.stringify(entry) + "\n";

  fs.appendFileSync(logFile, line);
}

function log(
  level: LogLevel,
  message: string,
  source?: string,
  context?: Record<string, unknown>,
  error?: unknown
): void {
  const entry = formatLogEntry(
    level,
    message,
    source,
    context,
    error instanceof Error ? error : error ? new Error(String(error)) : undefined
  );
  const jsonLine = JSON.stringify(entry);

  // Always output structured JSON to stdout
  console.log(jsonLine);

  // Also write to file in development
  writeToFile(entry);
}

export const logger = {
  debug(message: string, source?: string, context?: Record<string, unknown>): void {
    log("debug", message, source, context);
  },

  info(message: string, source?: string, context?: Record<string, unknown>): void {
    log("info", message, source, context);
  },

  warn(message: string, source?: string, error?: unknown, context?: Record<string, unknown>): void {
    log("warn", message, source, context, error);
  },

  error(
    message: string,
    source?: string,
    error?: unknown,
    context?: Record<string, unknown>
  ): void {
    log("error", message, source, context, error);
  },
};

// Express middleware for request logging
export function createRequestLogger() {
  return (req: { method: string; path: string; ip?: string; _hitServerAt?: number }, res: {
    statusCode: number;
    on: (event: string, handler: () => void) => void;
  }, next: () => void) => {
    const start = Date.now();

    res.on("finish", () => {
      const duration = Date.now() - start;
      const context: Record<string, unknown> = {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: duration,
        ip: req.ip,
      };

      // If the HIT SERVER middleware was installed before us, report
      // how long the request waited before any middleware ran.
      if (req._hitServerAt) {
        context.preHandlerMs = start - req._hitServerAt;
      }

      if (res.statusCode >= 500) {
        logger.error("Request failed", "express", undefined, context);
      } else if (res.statusCode >= 400) {
        logger.warn("Request error", "express", undefined, context);
      } else {
        logger.info("Request", "express", context);
      }
    });

    next();
  };
}
