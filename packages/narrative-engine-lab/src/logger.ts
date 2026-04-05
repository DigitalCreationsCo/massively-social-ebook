import path from "node:path";

export const verboseLog = {
    lab: (...args: unknown[]) => {
        if (process.env.NARRATIVE_VERBOSE === "true" || process.env.NODE_ENV === "development") {
            console.log(`[NarrativeLab]`, ...args);
        }
    },
    request: (method: string, path: string, details?: unknown) => {
        if (process.env.NARRATIVE_VERBOSE === "true" || process.env.NODE_ENV === "development") {
            console.log(`[NarrativeLab] → ${method} ${path}`, details ?? "");
        }
    },
    response: (method: string, path: string, status: number, duration?: number) => {
        if (process.env.NARRATIVE_VERBOSE === "true" || process.env.NODE_ENV === "development") {
            const durationStr = duration ? ` (${duration}ms)` : "";
            console.log(`[NarrativeLab] ← ${status} ${method} ${path}${durationStr}`);
        }
    },
    security: (event: string, details: unknown) => {
        if (process.env.NARRATIVE_VERBOSE === "true" || process.env.NODE_ENV === "development") {
            console.warn(`[NarrativeLab/Security] ${event}:`, details);
        }
    },
    config: (label: string, config: unknown) => {
        if (process.env.NARRATIVE_VERBOSE === "true" || process.env.NODE_ENV === "development") {
            console.log(`[NarrativeLab] Config [${label}]:`, JSON.stringify(config, null, 2));
        }
    },
    trace: (action: string, count?: number) => {
        if (process.env.NARRATIVE_VERBOSE === "true" || process.env.NODE_ENV === "development") {
            console.log(`[NarrativeLab] Trace [${action}]:`, count !== undefined ? `${count} entries` : "");
        }
    },
};

export const ledgerPath = path.join(process.cwd(), ".traces", "narrative_ledger.jsonl");