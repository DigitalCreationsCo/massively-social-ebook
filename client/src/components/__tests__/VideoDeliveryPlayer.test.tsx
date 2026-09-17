import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { VideoDeliveryPlayer } from "../VideoDeliveryPlayer";

vi.mock("hls.js", () => ({
  default: class Hls {
    static isSupported() {
      return false;
    }
  },
}));

vi.mock("@/lib/media-analytics", () => ({
  mediaAnalytics: {
    startSession: vi.fn(),
    endSession: vi.fn(),
    trackPlay: vi.fn(),
    trackPause: vi.fn(),
    trackComplete: vi.fn(),
    trackError: vi.fn(),
    trackBufferStart: vi.fn(),
    trackBufferEnd: vi.fn(),
    handlePlaybackObservation: vi.fn(),
  },
}));

describe("VideoDeliveryPlayer", () => {

  it("mounts configured captions as a native, selectable track", () => {
    const { container } = render(
      <VideoDeliveryPlayer
        manifestUrl="https://media.example/live.m3u8"
        isLive
        captionTracks={[{
          id: "en",
          label: "English",
          language: "en",
          kind: "captions",
          default: true,
          src: "https://captions.example/live.en.vtt",
        }]}
      />,
    );

    const track = container.querySelector("track");
    expect(track).toHaveAttribute("kind", "captions");
    expect(track).toHaveAttribute("srclang", "en");
    expect(track).toHaveAttribute("label", "English");
    expect(track).toHaveAttribute("src", "https://captions.example/live.en.vtt");
    expect(track).toHaveAttribute("default");
  });
});
