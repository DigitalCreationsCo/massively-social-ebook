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

if (!(global as any)[ LAB_TOKEN ]) {
  (global as any)[ LAB_TOKEN ] = process.env.LAB_SECRET || `lab_${randomUUID()}`;
}
const SESSION_SECRET = (global as any)[ LAB_TOKEN ];

export function securityGate(req: Request, res: Response, next: NextFunction) {
  const remoteAddress = req.socket.remoteAddress;
  const isLocal = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";

  if (!isLocal) {
    console.warn(`[Security] Blocked external access attempt from ${remoteAddress}`);
    return res.status(403).json({ error: "Access restricted to local loopback." });
  }

  const authHeader = req.headers[ "authorization" ];
  if (authHeader !== `Bearer ${SESSION_SECRET}`) {
    return res.status(401).json({ error: "Invalid or missing Narrative-Lab-Token." });
  }

  next();
}

const traceDir = path.join(process.cwd(), ".traces");
const ledgerPath = path.join(traceDir, "narrative_ledger.jsonl");



export function configureNarrativeLab(engine: NarrativeEngine) {
  // Use a global symbol to ensure the registry survives even if multiple 
  // versions of the package are accidentally loaded.
  const engineInstance = engine;
  (global as any)[ GLOBAL_KEY ] = engineInstance;
}

export function getActiveEngine(): NarrativeEngine {
  return (global as any)[ GLOBAL_KEY ] || new NarrativeEngine(new InMemoryNarrativeProvider());
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

  // Diagnostic Routes
  app.get("/__narrative_lab/config", (req, res) => {
    res.json({ config: engine.getLabConfig() });
  });

  app.post("/__narrative_lab/generate", async (req, res) => {
    try {
      const { channelId, query, config } = req.body as { channelId: string, query: string, config: LabConfig; };

      if (config) engine.setLabConfig(config);

      const result = await engine.generateContext(channelId || "lab-default", query || "");
      res.json({
        channelId,
        context: result,
        config: engine.getLabConfig(),
        traceStored: true
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Generation failed" });
    }
  });

  app.get("/__narrative_lab/traces", (req: Request, res: Response) => {

    try {
      let fileContentRaw = "";
      try {
        fileContentRaw = fs.readFileSync(ledgerPath, "utf-8");
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === 'ENOENT') {
          return res.json({ traces: [] });
        }
        console.error("[NarrativeLab] Trace read contention:", readError);
        throw readError;
      }

      const ledgerLines = fileContentRaw.split("\n").filter((line) => line.trim() !== "");
      const parsedTraces = ledgerLines.map((line) => JSON.parse(line));

      res.json({ traces: parsedTraces });
    } catch (err) {
      console.error("[NarrativeLab] Failed to parse narrative ledger:", err);
      res.status(500).json({ error: "Failed to read traces due to I/O lock or corruption" });
    }
  });

  app.delete("/__narrative_lab/traces", (req, res) => {
    try {
      if (fs.existsSync(ledgerPath)) {
        fs.unlinkSync(ledgerPath);
      }
      res.json({ status: "ok", message: "Ledger cleared" });
    } catch (err) {
      res.status(500).json({ error: "Failed to clear traces" });
    }
  });

  if (process.env.NODE_ENV === "development") {
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

    app.use(async (req, res, next) => {
      const url = req.originalUrl;

      if (url.startsWith('/__narrative_lab')) {
        return next();
      }

      try {
        // 1. Read index.html
        let template = fs.readFileSync(
          resolve(__dirname, "../lab/index.html"),
          "utf-8"
        );

        // 2. CRITICAL: Apply Vite HTML transforms. 
        // This injects the Tailwind/Vite client scripts and CSS links.
        template = await vite.transformIndexHtml(url, template);

        // 3. Send the rendered HTML
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    // Production: Serve static files from the build directory
    // Assuming your build tool outputs the server to /dist and UI to /dist/ui
    const distPath = resolve(__dirname, "ui");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(resolve(distPath, "index.html")));
  }

  server.listen(port, "127.0.0.1", () => {
    console.log(`\n Launching NarrativeEngine Lab: http://127.0.0.1:${port}`);
    console.log(`🔑 Token:  ${SESSION_SECRET}`);
    console.log(`🔗 Auth:   Include 'Authorization: Bearer ${SESSION_SECRET}' in headers\n`);
  });
}
