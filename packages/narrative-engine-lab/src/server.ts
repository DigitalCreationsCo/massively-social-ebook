import express from "express";
import * as fs from "fs";
import * as path from "path";
import type { NextFunction, Request, Response } from "express";
import { LabConfig, NarrativeEngine, InMemoryNarrativeProvider } from "narrative-engine";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { randomUUID } from "crypto";
import cors from "cors";
import { createServer } from "node:http";
import { GLOBAL_KEY, LAB_TOKEN, SESSION_SECRET } from "./registry";
import { ledgerPath, verboseLog } from "./logger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

export function getActiveEngine(): NarrativeEngine {
  const existing = (global as any)[ GLOBAL_KEY ];
  if (existing) {
    verboseLog.lab("Retrieved existing engine from registry");
    return existing;
  }
  verboseLog.lab("No engine in registry, creating new InMemoryNarrativeProvider with browser storage");
  const channelId = process.env.LAB_CHANNEL_ID || "lab-default";
  const provider = new InMemoryNarrativeProvider(undefined, undefined, {
    useBrowserStorage: true,
    channelId
  });
  return new NarrativeEngine(provider);
}

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
      const { channelId, query, config, newBlock } = req.body as { channelId: string, query: string, config: LabConfig; newBlock?: { content: string; isNotable?: boolean; }; };

      if (config) {
        verboseLog.lab("Updating engine config:", config);
        engine.setLabConfig(config);
      }

      let blockSaved = false;
      if (newBlock && newBlock.content) {
        const provider = engine[ 'provider' ];
        if (provider && typeof provider.addBlock === 'function') {
          const currentBlockCount = await provider.getBlockCount(channelId || "lab-default");
          const block = {
            id: currentBlockCount + 1,
            index: currentBlockCount + 1,
            content: newBlock.content,
            happenedAt: Date.now(),
            isNotable: newBlock.isNotable ?? false,
          };
          await provider.addBlock(channelId || "lab-default", block);
          verboseLog.lab("Block added to storage", { blockId: block.id, content: block.content.substring(0, 30) });
          blockSaved = true;
        } else {
          verboseLog.lab("Provider does not support addBlock - simulation block not persisted", { 
            providerType: provider?.getProviderType?.() ?? "unknown" 
          });
        }
      }

      const result = await engine.generateContext(channelId || "lab-default", query || "");
      const provider = (engine as any).provider;
      verboseLog.lab("Context generated", {
        channelId: channelId || "lab-default",
        queryLength: (query || "").length,
        contextLength: result.length,
        providerType: provider?.getProviderType?.() ?? "custom",
      });
      const isTracingEnabled = process.env.NODE_ENV === "development" || process.env.NARRATIVE_VERBOSE === "true";
      verboseLog.response("POST", "/generate", 200, Date.now() - startTime);
      res.json({
        channelId,
        context: result,
        config: engine.getLabConfig(),
        providerType: provider?.getProviderType?.() ?? "custom",
        traceStored: isTracingEnabled,
        blockSaved
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

  const distPath = resolve(__dirname, "..", "dist");

  if (process.env.NODE_ENV === "development") {
    verboseLog.lab("Starting Vite dev server integration");
    const vite = await import("vite");
    const { default: viteConfig } = await import("./vite.config");
    const devServer = await vite.createServer({
      ...viteConfig,
      server: { 
        middlewareMode: true,
        hmr: false,
      },
      appType: "spa",
      root: __dirname,
    });

    app.use(devServer.middlewares);
    verboseLog.lab("Vite middleware attached");

    app.use(async (req, res, next) => {
      const url = req.originalUrl;

      if (url.startsWith('/__narrative_lab')) {
        return next();
      }

      try {
        let template = fs.readFileSync(
          path.join(__dirname, "index.html"),
          "utf-8"
        );

        template = await devServer.transformIndexHtml(url, template);

        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        devServer.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    verboseLog.lab("Production mode: serving static files");
    app.use(express.static(distPath));
    app.get('/{*splat}', (req, res) => res.sendFile(path.join(distPath, "index.html")));
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
