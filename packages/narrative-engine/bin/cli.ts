#!/usr/bin/env node
import { startLabServer } from "../src/lab";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function boot() {
  const args = process.argv.slice(2).filter(arg => arg !== "--");
  const [ command, entryPath ] = args;

  if (command !== "lab") {
    console.error("Usage: npx narrativeengine lab <path-to-engine-config>");
    process.exit(1);
  }

  if (entryPath) {
    const absolutePath = resolve(process.cwd(), entryPath);
    console.log(`[Lab] Executing consumer configuration: ${entryPath}`);

    try {
      // Dynamically import the consumer's file. 
      // This triggers the call to configureNarrativeLab(engine).
      await import(absolutePath);
    } catch (err) {
      console.error(`[Lab] Failed to load ${entryPath}:`, err);
      process.exit(1);
    }
  }

  // Start the server using whatever engine ended up in the registry
  startLabServer();
}

boot();