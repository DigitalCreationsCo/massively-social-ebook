import * as fs from "fs";
import * as path from "path";
import type { LabConfig } from "./engine";

export interface TraceObject {
  timestamp: string;
  channelId: string;
  inputQuery: string;
  providerType?: string;
  phases: {
    harvest?: any;
    fusion?: any;
    saliency?: any;
    timeline?: any;
    prose?: any;
  };
  finalizedPrompt?: string;
  discardedCandidates?: any[];
  error?: string;
  labConfig?: LabConfig;
}

export function loggerNarrativeTrace(traceObject: TraceObject): void {
  const isTracingEnabled = process.env.NODE_ENV === "development" || process.env.NARRATIVE_VERBOSE === "true";
  if (!isTracingEnabled) return;

  try {
    const traceDir = path.join(process.cwd(), ".traces");
    if (!fs.existsSync(traceDir)) {
      fs.mkdirSync(traceDir, { recursive: true });
    }

    const filepath = path.join(traceDir, "narrative_ledger.jsonl");
    const traceContent = JSON.stringify(traceObject) + "\n";
    
    fs.appendFileSync(filepath, traceContent, "utf-8");
  } catch (err) {
    console.warn("[Trace] Failed to write trace file:", err);
  }
}
