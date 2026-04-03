import { type Express } from "express";
import { createServer as createViteServer, createLogger, type LogErrorOptions } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

export async function setupVite(server: Server, app: Express) {
  // Bug fix: When both `port` and `server` are set in hmr config, Vite tries to
  // open a *separate* standalone WebSocket server on that port. Since Express
  // already owns the port, the bind fails and the client WS connection is
  // immediately rejected ("WebSocket closed without opened").
  // Fix: pass only `server` so Vite attaches its WS upgrade handler to the
  // existing HTTP server — no separate port needed.
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      // Bug fix: previously called process.exit(1) for ANY Vite error message,
      // including transient/non-fatal warnings that Vite elevates to "error"
      // level (e.g. missing optional deps, peer dep mismatches). This killed
      // the entire Express dev server on unrelated noise.
      // Fix: only exit when the call includes an actual Error object, which
      // Vite uses exclusively for build-breaking failures.
      error: (msg: string, options?: LogErrorOptions) => {
        viteLogger.error(msg, options);
        if (options?.error) {
          console.error("[vite] Fatal build error — shutting down dev server.");
          process.exit(1);
        }
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);

  app.use(/^(?!\/api).*$/, async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk in case it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}
