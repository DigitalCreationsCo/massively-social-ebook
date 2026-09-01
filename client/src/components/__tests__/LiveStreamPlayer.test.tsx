import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LiveStreamPlayer } from "../LiveStreamPlayer";

// Mock Hls.js
vi.mock("hls.js", () => ({
  default: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    loadSource: vi.fn(),
    attachMedia: vi.fn(),
    destroy: vi.fn(),
    Events: {
      MANIFEST_PARSED: 'MANIFEST_PARSED',
      ERROR: 'ERROR',
    },
  })),
  isSupported: vi.fn(() => true),
}));

// Mock media analytics
vi.mock("@/lib/media-analytics", () => ({
  mediaAnalytics: {
    startSession: vi.fn(() => "test-session-id"),
    endSession: vi.fn(),
    trackPlay: vi.fn(),
    trackPause: vi.fn(),
    trackBufferStart: vi.fn(),
    trackBufferEnd: vi.fn(),
    trackQualityChange: vi.fn(),
    trackError: vi.fn(),
    trackSeek: vi.fn(),
    trackComplete: vi.fn(),
    destroy: vi.fn(),
  },
}));

describe("LiveStreamPlayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock HTMLVideoElement
    HTMLVideoElement.prototype.play = vi.fn(() => Promise.resolve());
    HTMLVideoElement.prototype.pause = vi.fn();
    HTMLVideoElement.prototype.load = vi.fn();
    HTMLVideoElement.prototype.canPlayType = vi.fn(() => '');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders idle state when manifestUrl is not provided", () => {
    render(<LiveStreamPlayer manifestUrl={null} isLive={false} />);
    
    expect(screen.getByText("Signal pending")).toBeInTheDocument();
    expect(screen.getByText("This channel is preparing to air.")).toBeInTheDocument();
  });

  it("renders loading state when manifestUrl is provided", () => {
    render(<LiveStreamPlayer manifestUrl="http://example.com/stream.m3u8" isLive={true} />);
    
    const video = screen.getByLabelText("Live broadcast video");
    expect(video).toBeInTheDocument();
  });

  it("renders custom controls when stream is available", () => {
    render(<LiveStreamPlayer manifestUrl="http://example.com/stream.m3u8" isLive={true} />);
    
    // Check for control buttons
    expect(screen.getByLabelText(/Turn sound on|Mute broadcast/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Pause broadcast|Play broadcast/i)).toBeInTheDocument();
  });

  it("toggles mute when mute button is clicked", () => {
    render(<LiveStreamPlayer manifestUrl="http://example.com/stream.m3u8" isLive={true} />);
    
    const muteButton = screen.getByLabelText("Turn sound on");
    muteButton.click();
    
    expect(screen.getByLabelText("Mute broadcast")).toBeInTheDocument();
  });

  it("handles playback toggle", () => {
    render(<LiveStreamPlayer manifestUrl="http://example.com/stream.m3u8" isLive={true} />);
    
    const playButton = screen.getByLabelText("Play broadcast");
    playButton.click();
    
    expect(screen.getByLabelText("Pause broadcast")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(
      <LiveStreamPlayer 
        manifestUrl="http://example.com/stream.m3u8" 
        isLive={true} 
        className="custom-class" 
      />
    );
    
    const wrapper = container.querySelector(".custom-class");
    expect(wrapper).toBeInTheDocument();
  });

  it("uses custom channelId when provided", () => {
    const { mediaAnalytics } = require("@/lib/media-analytics");
    
    render(<LiveStreamPlayer manifestUrl="http://example.com/stream.m3u8" isLive={true} channelId="custom-channel" />);
    
    expect(mediaAnalytics.startSession).toHaveBeenCalledWith("custom-channel", "hls");
  });

  it("detects HLS media type from .m3u8 URL", () => {
    const { mediaAnalytics } = require("@/lib/media-analytics");
    
    render(<LiveStreamPlayer manifestUrl="http://example.com/stream.m3u8" isLive={true} />);
    
    expect(mediaAnalytics.startSession).toHaveBeenCalledWith("default", "hls");
  });

  it("detects MP4 media type from .mp4 URL", () => {
    const { mediaAnalytics } = require("@/lib/media-analytics");
    
    render(<LiveStreamPlayer manifestUrl="http://example.com/video.mp4" isLive={false} />);
    
    expect(mediaAnalytics.startSession).toHaveBeenCalledWith("default", "mp4");
  });
});