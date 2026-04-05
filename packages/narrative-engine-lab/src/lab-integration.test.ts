import { describe, it, expect, afterEach } from "vitest";
import { NarrativeEngine, configureLabEngine, getActiveEngine, GLOBAL_KEY } from "narrative-engine";

describe("NarrativeEngine Lab Integration", () => {
  afterEach(() => {
    delete (global as any)[GLOBAL_KEY];
  });

  describe("Engine Registration", () => {
    it("should make registered engine available to lab server", () => {
      class MockRagProvider {
        getProviderType() {
          return "rag-pg";
        }
        async getBlockCount() {
          return 42;
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

      const mockProvider = new MockRagProvider();
      const engine = new NarrativeEngine(mockProvider as any);

      configureLabEngine(engine);

      const retrieved = getActiveEngine();
      expect(retrieved).toBe(engine);
      expect((engine as any).provider).toBe(mockProvider);
      expect(mockProvider.getProviderType()).toBe("rag-pg");
    });

    it("should return registered engine, not a new instance", () => {
      const customEngine = new NarrativeEngine();
      configureLabEngine(customEngine);

      const retrieved = getActiveEngine();

      expect(retrieved).toBe(customEngine);
    });
  });

  describe("Provider Type Propagation", () => {
    it("should expose provider type through engine", () => {
      class TestProvider {
        getProviderType() {
          return "test-provider";
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

      const provider = new TestProvider();
      const engine = new NarrativeEngine(provider as any);

      configureLabEngine(engine);

      const retrieved = getActiveEngine();
      const providerType = (retrieved as any).provider?.getProviderType?.();

      expect(providerType).toBe("test-provider");
    });
  });
});
