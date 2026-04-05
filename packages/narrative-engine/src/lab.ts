import type { NarrativeEngine } from "./engine";

export const GLOBAL_KEY = Symbol.for("narrative.engine.registry");
export const LAB_TOKEN = Symbol.for("narrative.lab.token");

export function configureLabEngine(engine: NarrativeEngine): void {
  (global as any)[GLOBAL_KEY] = engine;
}

export function getActiveEngine(): NarrativeEngine | undefined {
  return (global as any)[GLOBAL_KEY];
}
