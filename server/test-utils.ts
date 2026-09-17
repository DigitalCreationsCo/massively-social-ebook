import { vi } from "vitest";

import { setChannelRegistryForTests } from "./channel-registry";

/**
 * Shared test fixture for suites that boot route registration.
 *
 * `registerRoutes` constructs a `BroadcastRuntime`, whose configuration
 * loads from the process-wide channel registry — the same registry the
 * production server initializes at startup in `server/index.ts`. Tests
 * bypass startup, so they must seed the registry explicitly or every
 * request fails with "Channel registry has not been initialized."
 */
export function seedTestChannelRegistry(): void {
  setChannelRegistryForTests({
    channels: {
      main: {
        controlEndpoint: "https://stream.example.test/channel/",
        queueTokenEnv: "TEST_QUEUE_TOKEN",
        requiredEntities: ["px://test/character/lead"],
      },
    },
    entities: {},
  });
  if (!process.env.TEST_QUEUE_TOKEN) {
    vi.stubEnv("TEST_QUEUE_TOKEN", "test-token");
  }
}
