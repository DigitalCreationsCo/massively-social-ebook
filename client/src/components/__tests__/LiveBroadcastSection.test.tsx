import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { episodeProgressPercent, LiveBroadcastSection } from "../LiveBroadcastSection";
import { useLiveChannel } from "@/hooks/use-live-channel";
import { usePlayback } from "@/hooks/use-playback";

vi.mock("@/hooks/use-live-channel");
vi.mock("@/hooks/use-playback");
vi.mock("@/components/VideoDeliveryPlayer", () => ({
  VideoDeliveryPlayer: ({ manifestUrl }: { manifestUrl?: string }) => <div data-testid="video-delivery-player">{manifestUrl || "no manifest"}</div>,
}));

const baseLiveState = {
  isLoading: false,
  isSessionLive: false,
  wsConnected: true,
  viewerCount: 0,
  chatHistory: [],
  mostRecentMessage: null,
  username: "tester",
  submitChat: vi.fn(),
};

describe("LiveBroadcastSection component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useLiveChannel as any).mockReturnValue(baseLiveState);
  });

  it("renders when broadcast signal is unavailable", () => {
    (usePlayback as any).mockReturnValue({ isLoading: false, data: null, isError: false });
    render(<LiveBroadcastSection />);

    expect(screen.getAllByText(/signal unavailable/i)).not.toHaveLength(0);
    expect(screen.getByTestId("video-delivery-player")).toHaveTextContent("no manifest");
  });

  it("uses the playback API signal and its real viewer count", () => {
    (usePlayback as any).mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        playback: { sessionId: "session-1", playbackManifestUrl: "https://media.example/live.m3u8" },
        delivery: { isRunning: true, isHealthy: true },
        broadcast: {
          desiredState: "running", mode: "continuous", sessionStatus: "active", viewerCount: 12450,
          sessionScheduledStartAt: Date.now() - 50_000,
          sessionScheduledEndAt: Date.now() + 50_000,
        },
      },
    });
    render(<LiveBroadcastSection />);

    expect(screen.getAllByText(/on air/i)).not.toHaveLength(0);
    expect(screen.getByLabelText("12.5K viewers")).toBeInTheDocument();
    expect(screen.getByTestId("video-delivery-player")).toHaveTextContent("https://media.example/live.m3u8");
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("explains a delivery failure while preserving chat and watch access", () => {
    (usePlayback as any).mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        playback: null,
        delivery: { isRunning: false, isHealthy: false, lastError: "Manifest is not available" },
        broadcast: { desiredState: "running", mode: "continuous", sessionStatus: "active", viewerCount: 0 },
      },
    });
    render(<LiveBroadcastSection />);

    expect(screen.getByText(/manifest is not available/i)).toBeInTheDocument();
  });

  it("shows a paused production state while the Streamer is unavailable", () => {
    (usePlayback as any).mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        playback: null,
        delivery: { isRunning: false, isHealthy: false },
        broadcast: {
          desiredState: "running",
          mode: "waiting_for_streamer",
          sessionStatus: "preparing",
          viewerCount: 0,
          streamer: { state: "unavailable", reason: "Streamer control API is unreachable" },
        },
      },
    });
    render(<LiveBroadcastSection />);

    expect(screen.getAllByText(/^paused$/i)).not.toHaveLength(0);
    expect(screen.getByText(/service reconnecting: streamer control api is unreachable/i)).toBeInTheDocument();
  });
});

describe("episodeProgressPercent", () => {
  it("uses the coordinator's scheduled session bounds and clamps safely", () => {
    expect(episodeProgressPercent(1_000, 2_000, 1_500)).toBe(50);
    expect(episodeProgressPercent(1_000, 2_000, 500)).toBe(0);
    expect(episodeProgressPercent(1_000, 2_000, 2_500)).toBe(100);
    expect(episodeProgressPercent(undefined, 2_000, 1_500)).toBe(0);
    expect(episodeProgressPercent(2_000, 1_000, 1_500)).toBe(0);
  });
});
