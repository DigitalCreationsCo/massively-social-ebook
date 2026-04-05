import { describe, it, expect, afterEach } from "vitest";
import { NarrativeEngine } from "./engine";
import { configureLabEngine, getActiveEngine, GLOBAL_KEY, LAB_TOKEN } from "./lab";

describe("Lab Engine Registry", () => {
  afterEach(() => {
    delete (global as any)[GLOBAL_KEY];
    delete (global as any)[LAB_TOKEN];
  });

  describe("GLOBAL_KEY", () => {
    it("should be a Symbol with correct description", () => {
      expect(GLOBAL_KEY).toBeTypeOf("symbol");
      expect(GLOBAL_KEY.description).toBe("narrative.engine.registry");
    });

    it("should be retrievable across module boundaries", () => {
      const engine = new NarrativeEngine();
      (global as any)[GLOBAL_KEY] = engine;

      const retrieved = (global as any)[GLOBAL_KEY];
      expect(retrieved).toBe(engine);
    });
  });
});

describe("configureLabEngine", () => {
  afterEach(() => {
    delete (global as any)[GLOBAL_KEY];
  });

  it("should register engine to global registry", () => {
    const engine = new NarrativeEngine();
    configureLabEngine(engine);

    expect((global as any)[GLOBAL_KEY]).toBe(engine);
  });

  it("should make engine retrievable via getActiveEngine", () => {
    const engine = new NarrativeEngine();
    configureLabEngine(engine);

    const retrieved = getActiveEngine();
    expect(retrieved).toBe(engine);
  });

  it("should overwrite previously registered engine", () => {
    const engine1 = new NarrativeEngine();
    const engine2 = new NarrativeEngine();

    configureLabEngine(engine1);
    configureLabEngine(engine2);

    expect((global as any)[GLOBAL_KEY]).toBe(engine2);
  });
});

describe("getActiveEngine", () => {
  afterEach(() => {
    delete (global as any)[GLOBAL_KEY];
  });

  it("should return registered engine if available", () => {
    const customEngine = new NarrativeEngine();
    configureLabEngine(customEngine);

    const result = getActiveEngine();
    expect(result).toBe(customEngine);
  });

  it("should return same instance when called multiple times", () => {
    const engine = new NarrativeEngine();
    configureLabEngine(engine);

    const result1 = getActiveEngine();
    const result2 = getActiveEngine();

    expect(result1).toBe(result2);
    expect(result1).toBe(engine);
  });
});

describe("Lab Integration", () => {
  afterEach(() => {
    delete (global as any)[GLOBAL_KEY];
  });

  it("should preserve provider type from custom provider", () => {
    class CustomProvider {
      getProviderType() {
        return "custom-db";
      }
      async getBlockCount() {
        return 0;
      }
      async getLoreAtoms() {
        return [];
      }
      async getHybridSearchCandidates() {
        return [];
      }
      async getBlocksByIndices() {
        return [];
      }
      async getNotableEvents() {
        return [];
      }
    }

    const customProvider = new CustomProvider();
    const engine = new NarrativeEngine(customProvider as any);
    configureLabEngine(engine);

    const retrieved = getActiveEngine();
    expect(retrieved).toBe(engine);
    expect((engine as any).provider).toBe(customProvider);
  });
});
