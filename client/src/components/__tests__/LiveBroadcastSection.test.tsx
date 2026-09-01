import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LiveBroadcastSection } from "../LiveBroadcastSection";
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

    expect(screen.getByText(/signal unavailable/i)).toBeInTheDocument();
    expect(screen.getByTestId("video-delivery-player")).toHaveTextContent("no manifest");
  });

  it("uses the playback API signal and its real viewer count", () => {
    (usePlayback as any).mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        playback: { sessionId: "session-1", playbackManifestUrl: "https://media.example/live.m3u8" },
        delivery: { isRunning: true, isHealthy: true },
        broadcast: { desiredState: "running", mode: "continuous", sessionStatus: "active", viewerCount: 12450 },
      },
    });
    render(<LiveBroadcastSection />);

    expect(screen.getByText(/on air/i)).toBeInTheDocument();
    expect(screen.getByText("12.5K")).toBeInTheDocument();
    expect(screen.getByTestId("video-delivery-player")).toHaveTextContent("https://media.example/live.m3u8");
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

    expect(screen.getByText(/production paused/i)).toBeInTheDocument();
    expect(screen.getByText(/service reconnecting: streamer control api is unreachable/i)).toBeInTheDocument();
  });
});
