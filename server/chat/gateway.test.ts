import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMock = vi.hoisted(() => ({
  getActiveSession: vi.fn(),
  getNextSession: vi.fn(),
  createChatIfAbsent: vi.fn(),
}));

vi.mock("../storage", () => ({ storage: storageMock }));

import { ChatGateway } from "./gateway";

describe("ChatGateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getActiveSession.mockResolvedValue(undefined);
    storageMock.getNextSession.mockResolvedValue(undefined);
  });

  it("persists normalized provider messages before fan-out and suppresses duplicates", async () => {
    const broadcast = vi.fn();
    const configs = new Map([["main", {
      channelId: "main",
      endpoint: "https://stream.example.test/channel",
      queueToken: "secret",
    }]]);
    const persisted = {
      id: 10,
      channelId: "main",
      sessionId: null,
      blockId: null,
      username: "Ada",
      messageId: "external:youtube-live:provider-1",
      authorId: "external:youtube-live:author-1",
      authorDisplayName: "Ada",
      text: "Hello",
      sentAt: new Date("2026-08-31T12:00:00Z"),
      provenance: { kind: "external", provider: "youtube-live", providerMessageId: "provider-1" },
      createdAt: new Date("2026-08-31T12:00:00Z"),
    };
    storageMock.createChatIfAbsent
      .mockResolvedValueOnce({ message: persisted, inserted: true })
      .mockResolvedValueOnce({ message: persisted, inserted: false });
    const gateway = new ChatGateway(configs, broadcast);
    await gateway.initialize();

    const event = {
      provider: "youtube-live",
      providerMessageId: "provider-1",
      authorId: "author-1",
      authorDisplayName: "Ada",
      text: "Hello",
      sentAt: "2026-08-31T12:00:00Z",
    };
    await gateway.ingestExternal("main", event);
    await gateway.ingestExternal("main", event);

    expect(storageMock.createChatIfAbsent).toHaveBeenCalledTimes(2);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith("main", expect.objectContaining({
      type: "CHAT_MESSAGE",
      payload: expect.objectContaining({
        messageId: "external:youtube-live:provider-1",
        authorId: "external:youtube-live:author-1",
        provenance: { kind: "external", provider: "youtube-live", providerMessageId: "provider-1" },
      }),
    }));
    expect(storageMock.createChatIfAbsent.mock.invocationCallOrder[0]).toBeLessThan(
      broadcast.mock.invocationCallOrder[0],
    );
    gateway.shutdown();
  });
});
