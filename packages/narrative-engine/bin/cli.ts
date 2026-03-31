#!/usr/bin/env node
import { resolve } from "path";

async function boot() {
  const args = process.argv.slice(2).filter(arg => arg !== "--");
  const [ command, entryPath ] = args;

  if (command !== "lab") {
    console.error("Usage: npx narrativeengine lab <path-to-engine-config>");
    console.error("\nTo use the NarrativeEngine Lab, install the narrative-engine-lab package:");
    console.error("  npm install narrative-engine-lab");
    console.error("  npx narrativeengine-lab lab <path-to-engine-config>");
    process.exit(1);
  }

  try {
    const lab = await import("narrative-engine-lab");
    
    if (entryPath) {
      const absolutePath = resolve(process.cwd(), entryPath);
      console.log(`[Lab] Executing consumer configuration: ${entryPath}`);
      try {
        await import(absolutePath);
      } catch (err) {
        console.error(`[Lab] Failed to load ${entryPath}:`, err);
        process.exit(1);
      }
    }

    lab.startLabServer();
  } catch (err) {
    console.error("[Lab] Failed to start lab server:", err);
    console.error("\nPlease ensure narrative-engine-lab is installed:");
    console.error("  npm install narrative-engine-lab");
    process.exit(1);
  }
}

boot();