import { defineConfig, loadEnv } from "vite";
import path from "path";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiBaseUrl = env.VITE_API_BASE_URL || "http://localhost:5001";

  return {
    base: "",
    plugins: [react()],
    server: {
      port: 3001,
      proxy: {
        "/api": {
          target: apiBaseUrl,
          changeOrigin: true,
        },
        "/admin": {
          target: apiBaseUrl,
          changeOrigin: true,
        },
      },
    },
    resolve: {
      alias: {
        "@shared": path.resolve(import.meta.dirname, "../shared"),
        "@client": path.resolve(import.meta.dirname, "../client/src"),
      },
      dedupe: ["react", "react-dom", "@tanstack/react-query"],
    },
    external: ["react", "react-dom", "@tanstack/react-query"],
  };
});
