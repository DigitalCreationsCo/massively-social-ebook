import { NarrativeEngine } from "narrative-engine";
import { GLOBAL_KEY } from "./registry";

export function configureLabEngine(engine: NarrativeEngine) {
    const providerType = engine['provider']?.getProviderType?.() ?? "unknown";
    console.log("[ConfigureLabEngine] Registering engine with provider type:", providerType);
    (global as any)[ GLOBAL_KEY ] = engine;
    console.log("[ConfigureLabEngine] Engine registered, global key:", (global as any)[GLOBAL_KEY] ? "SET" : "UNDEFINED");
}