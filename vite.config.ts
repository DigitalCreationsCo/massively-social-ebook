import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig({
  root: "client",
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      "narrative-engine": path.resolve(import.meta.dirname, "packages/narrative-engine"),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: [
      "**/*.{test,spec}.?(c|m)[jt]s?(x)",
      "../server/**/*.{test,spec}.?(c|m)[jt]s?(x)",
      "../shared/**/*.{test,spec}.?(c|m)[jt]s?(x)",
      // Only include src from packages, not dist (dist contains old compiled tests)
      "../packages/**/src/**/*.{test,spec}.?(c|m)[jt]s?(x)",
    ],
    setupFiles: [ path.resolve(import.meta.dirname, "client/src/test/setup.ts") ],
    coverage: {
      provider: "v8",
      reporter: [ "text", "json", "html" ],
      include: [ "client/src/**", "server/**" ],
      exclude: [ "node_modules/**", "client/src/test/setup.ts", "**/*.test.ts", "**/dist/**" ],
    },
  },
});
