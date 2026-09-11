import { afterEach, describe, expect, it, vi } from "vitest";

import { loadBroadcastConfig } from "./config";
import { setChannelRegistryForTests } from "../channel-registry";

afterEach(() => {
  vi.unstubAllEnvs();
});

function configure(registry: unknown) {
  setChannelRegistryForTests({
    channels: Object.fromEntries(Object.entries(registry as Record<string, object>).map(([channelId, channel]) => [
      channelId,
      { ...channel, requiredEntities: ["px://test/character/lead"] },
    ])),
    entities: {},
  });
  vi.stubEnv("TEST_QUEUE_TOKEN", "server-secret");
}

describe("broadcast configuration", () => {
  it("normalizes a control endpoint and resolves its token by environment reference", () => {
    configure({ main: { controlEndpoint: "https://stream.example.test/channel/", queueTokenEnv: "TEST_QUEUE_TOKEN" } });

    const config = loadBroadcastConfig().get("main");

    expect(config).toMatchObject({
      channelId: "main",
      endpoint: "https://stream.example.test/channel",
      queueToken: "server-secret",
    });
  });

  it("accepts the legacy endpoint field only for a compatible deployment migration", () => {
    configure({ main: { endpoint: "https://stream.example.test/control", queueTokenEnv: "TEST_QUEUE_TOKEN" } });
    expect(loadBroadcastConfig().get("main")?.endpoint).toBe("https://stream.example.test/control");
  });

  it("rejects the Streamer's public HLS listener as a queue control endpoint", () => {
    configure({ main: { controlEndpoint: "http://localhost:8888/live/index.m3u8", queueTokenEnv: "TEST_QUEUE_TOKEN" } });
    expect(() => loadBroadcastConfig()).toThrow(/control API.*:8000.*HLS/i);
  });

  it("rejects duplicate queue identities", () => {
    configure({
      first: { controlEndpoint: "https://stream.example.test/channel/", queueTokenEnv: "TEST_QUEUE_TOKEN" },
      second: { controlEndpoint: "https://stream.example.test/channel", queueTokenEnv: "TEST_QUEUE_TOKEN" },
    });

    expect(() => loadBroadcastConfig()).toThrow(/more than one channel/i);
  });

  it("rejects channel identifiers that cannot be represented in queue and API paths", () => {
    expect(() => configure({
      "px://25th-chapter": {
        controlEndpoint: "https://stream.example.test/channel",
        queueTokenEnv: "TEST_QUEUE_TOKEN",
      },
    })).toThrow(/URL-path-safe/i);
  });

  it.each([
    "https://user:password@stream.example.test/channel",
    "https://stream.example.test/channel?token=leak",
    "https://stream.example.test/channel#fragment",
  ])("rejects unsafe endpoint metadata: %s", (endpoint) => {
    configure({ main: { controlEndpoint: endpoint, queueTokenEnv: "TEST_QUEUE_TOKEN" } });
    expect(() => loadBroadcastConfig()).toThrow();
  });

  it("requires HTTPS control endpoints in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    configure({ main: { controlEndpoint: "http://stream.example.test/channel", queueTokenEnv: "TEST_QUEUE_TOKEN" } });
    expect(() => loadBroadcastConfig()).toThrow(/HTTPS/i);
  });

  it("validates every referenced provider secret during startup", () => {
    configure({
      main: {
        endpoint: "https://stream.example.test/channel",
        queueTokenEnv: "TEST_QUEUE_TOKEN",
        youtube: {
          liveChatId: "chat-id",
          clientIdEnv: "YOUTUBE_CLIENT_ID",
          clientSecretEnv: "YOUTUBE_CLIENT_SECRET",
          refreshTokenEnv: "YOUTUBE_REFRESH_TOKEN",
        },
      },
    });
    expect(() => loadBroadcastConfig()).toThrow(/YOUTUBE_CLIENT_ID/);
  });
});
