import express from "express";
import * as fs from "fs";
import * as path from "path";
import type { Express, NextFunction, Request, Response } from "express";
import { LabConfig, NarrativeEngine } from "./engine";
import { InMemoryNarrativeProvider } from "./provider";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { randomUUID } from "crypto";
import cors from "cors";
import { createServer } from "node:http";
import { createServer as createViteServer } from "vite";
import viteConfig from "../lab/vite.config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GLOBAL_KEY = Symbol.for("narrative.engine.registry");
const LAB_TOKEN = Symbol.for("narrative.lab.token");

const verboseLog = {
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

if (!(global as any)[ LAB_TOKEN ]) {
  (global as any)[ LAB_TOKEN ] = process.env.LAB_SECRET || `lab_${randomUUID()}`;
}
const SESSION_SECRET = (global as any)[ LAB_TOKEN ];

export function securityGate(req: Request, res: Response, next: NextFunction) {
  const remoteAddress = req.socket.remoteAddress;
  const isLocal = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";

  if (!isLocal) {
    verboseLog.security("BLOCKED_EXTERNAL", { address: remoteAddress, path: req.path });
    return res.status(403).json({ error: "Access restricted to local loopback." });
  }

  const authHeader = req.headers[ "authorization" ];
  if (authHeader !== `Bearer ${SESSION_SECRET}`) {
    verboseLog.security("BLOCKED_INVALID_TOKEN", { 
      hasHeader: !!authHeader, 
      path: req.path,
      remoteAddress,
    });
    return res.status(401).json({ error: "Invalid or missing Narrative-Lab-Token." });
  }

  verboseLog.security("ALLOWED", { path: req.path, remoteAddress });
  next();
}

const traceDir = path.join(process.cwd(), ".traces");
const ledgerPath = path.join(traceDir, "narrative_ledger.jsonl");



export function configureNarrativeLab(engine: NarrativeEngine) {
  verboseLog.lab("Configuring NarrativeEngine instance");
  const engineInstance = engine;
  (global as any)[ GLOBAL_KEY ] = engineInstance;
  verboseLog.lab("Engine registered to global registry");
}

export function getActiveEngine(): NarrativeEngine {
  const existing = (global as any)[ GLOBAL_KEY ];
  if (existing) {
    verboseLog.lab("Retrieved existing engine from registry");
    return existing;
  }
  verboseLog.lab("No engine in registry, creating new InMemoryNarrativeProvider");
  return new NarrativeEngine(new InMemoryNarrativeProvider());
}

/**
 * Internal function to boot the Express diagnostic surface.
 */
export async function startLabServer(port: number = 5002): Promise<void> {
  const app = express();
  const server = createServer(app);

  if (!(global as any)[ LAB_TOKEN ]) {
    (global as any)[ LAB_TOKEN ] = `lab_${randomUUID().slice(0, 8)}`;
  }

  app.use(cors({
    origin: [
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5002",
    ],
    methods: [ "GET", "POST", "OPTIONS" ],
    allowedHeaders: [ "Content-Type", "Authorization" ]
  }));

  app.use(express.json());

  app.use("/__narrative_lab", securityGate);

  const engine = getActiveEngine();
  verboseLog.lab("Lab server initialized with engine");

  // Diagnostic Routes
  app.get("/__narrative_lab/config", (req, res) => {
    verboseLog.request("GET", "/config");
    const startTime = Date.now();
    const config = engine.getLabConfig();
    verboseLog.config("Current", config);
    verboseLog.response("GET", "/config", 200, Date.now() - startTime);
    res.json({ config });
  });

  app.post("/__narrative_lab/generate", async (req, res) => {
    const startTime = Date.now();
    verboseLog.request("POST", "/generate", req.body);
    try {
      const { channelId, query, config } = req.body as { channelId: string, query: string, config: LabConfig; };

      if (config) {
        verboseLog.lab("Updating engine config:", config);
        engine.setLabConfig(config);
      }

      const result = await engine.generateContext(channelId || "lab-default", query || "");
      verboseLog.lab("Context generated", {
        channelId: channelId || "lab-default",
        queryLength: (query || "").length,
        contextLength: result.length,
      });
      verboseLog.response("POST", "/generate", 200, Date.now() - startTime);
      res.json({
        channelId,
        context: result,
        config: engine.getLabConfig(),
        traceStored: true
      });
    } catch (err) {
      verboseLog.lab("Generation failed:", err instanceof Error ? err.message : String(err));
      verboseLog.response("POST", "/generate", 500, Date.now() - startTime);
      res.status(500).json({ error: err instanceof Error ? err.message : "Generation failed" });
    }
  });

  app.get("/__narrative_lab/traces", (req: Request, res) => {
    const startTime = Date.now();
    verboseLog.request("GET", "/traces");

    try {
      let fileContentRaw = "";
      try {
        fileContentRaw = fs.readFileSync(ledgerPath, "utf-8");
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === 'ENOENT') {
          verboseLog.trace("Read", 0);
          verboseLog.response("GET", "/traces", 200, Date.now() - startTime);
          return res.json({ traces: [] });
        }
        console.error("[NarrativeLab] Trace read contention:", readError);
        throw readError;
      }

      const ledgerLines = fileContentRaw.split("\n").filter((line) => line.trim() !== "");
      const parsedTraces = ledgerLines.map((line) => JSON.parse(line));

      verboseLog.trace("Read", parsedTraces.length);
      verboseLog.response("GET", "/traces", 200, Date.now() - startTime);
      res.json({ traces: parsedTraces });
    } catch (err) {
      console.error("[NarrativeLab] Failed to parse narrative ledger:", err);
      verboseLog.response("GET", "/traces", 500, Date.now() - startTime);
      res.status(500).json({ error: "Failed to read traces due to I/O lock or corruption" });
    }
  });

  app.delete("/__narrative_lab/traces", (req, res) => {
    const startTime = Date.now();
    verboseLog.request("DELETE", "/traces");
    try {
      if (fs.existsSync(ledgerPath)) {
        fs.unlinkSync(ledgerPath);
        verboseLog.trace("Cleared");
      } else {
        verboseLog.trace("Cleared (no file existed)");
      }
      verboseLog.response("DELETE", "/traces", 200, Date.now() - startTime);
      res.json({ status: "ok", message: "Ledger cleared" });
    } catch (err) {
      verboseLog.lab("Failed to clear traces:", err);
      verboseLog.response("DELETE", "/traces", 500, Date.now() - startTime);
      res.status(500).json({ error: "Failed to clear traces" });
    }
  });

  if (process.env.NODE_ENV === "development") {
    verboseLog.lab("Starting Vite dev server integration");
    const vite = await createViteServer({
      ...viteConfig,
      server: { 
        middlewareMode: true,
        hmr: false,
      },
      appType: "spa",
      root: resolve(__dirname, "../lab"),
    });

    app.use(vite.middlewares);
    verboseLog.lab("Vite middleware attached");

    app.use(async (req, res, next) => {
      const url = req.originalUrl;

      if (url.startsWith('/__narrative_lab')) {
        return next();
      }

      try {
        let template = fs.readFileSync(
          resolve(__dirname, "../lab/index.html"),
          "utf-8"
        );

        template = await vite.transformIndexHtml(url, template);

        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    verboseLog.lab("Production mode: serving static files");
    const distPath = resolve(__dirname, "ui");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(resolve(distPath, "index.html")));
  }

  server.listen(port, "127.0.0.1", () => {
    console.log(`\n╔════════════════════════════════════════════════════════════╗`);
    console.log(`║          NarrativeEngine Lab Started                   ║`);
    console.log(`╠════════════════════════════════════════════════════════╣`);
    console.log(`║  URL:      http://127.0.0.1:${port}                       `);
    console.log(`║  Token:    ${SESSION_SECRET}`);
    console.log(`║  Auth:     Authorization: Bearer ${SESSION_SECRET}`);
    console.log(`║  Verbose:  NARRATIVE_VERBOSE=true`);
    console.log(`╚════════════════════════════════════════════════════════╝\n`);
    verboseLog.lab("Server listening on port", port);
  });
}
