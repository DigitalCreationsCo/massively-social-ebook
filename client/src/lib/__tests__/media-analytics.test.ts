import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mediaAnalytics, type MediaAnalyticsEvent, type MediaAnalyticsSession } from "../media-analytics";

// Mock Mixpanel
const mockMixpanel = {
  track: vi.fn(),
};

declare global {
  interface Window {
    mixpanel: typeof mockMixpanel;
  }
}

describe("MediaAnalytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the singleton by creating a new instance (in real code, you'd want a proper reset method)
    (mediaAnalytics as any).currentSession = null;
    (mediaAnalytics as any).eventQueue = [];
    (mediaAnalytics as any).currentBufferStart = null;
    window.mixpanel = mockMixpanel;
  });

  afterEach(() => {
    delete (window as any).mixpanel;
    mediaAnalytics.destroy();
  });

  describe("Session Management", () => {
    it("starts a new session with unique ID", () => {
      const sessionId1 = mediaAnalytics.startSession("test-channel", "hls");
      const sessionId2 = mediaAnalytics.startSession("test-channel", "hls");
      
      expect(sessionId1).not.toBe(sessionId2);
      expect(sessionId1).toMatch(/^media_\d+_[a-z0-9]+$/);
    });

    it("tracks session start event", () => {
      mediaAnalytics.startSession("test-channel", "hls");
      
      expect(mockMixpanel.track).toHaveBeenCalledWith("media_session_start", {
        session_id: expect.any(String),
        channel_id: "test-channel",
        media_type: "hls",
      });
    });

    it("ends session and calculates metrics", () => {
      const sessionId = mediaAnalytics.startSession("test-channel", "hls");
      
      // Simulate some activity
      mediaAnalytics.trackBufferStart();
      mediaAnalytics.trackBufferEnd();
      mediaAnalytics.trackError("Test error");
      
      // endSession returns the session it closed, since the final metrics only
      // exist once it is over.
      const session = mediaAnalytics.endSession(120, 60); // 120s duration, watched 60s
      
      expect(session?.completionRate).toBe(50); // 60/120 * 100
      expect(session?.bufferCount).toBe(1);
      expect(session?.errorCount).toBe(1);
      // and the live session is cleared
      expect(mediaAnalytics.getCurrentSession()).toBeNull();
    });

    it("tracks session end event", () => {
      mediaAnalytics.startSession("test-channel", "hls");
      mediaAnalytics.endSession(120, 60);
      
      expect(mockMixpanel.track).toHaveBeenCalledWith("media_session_end", expect.objectContaining({
        channel_id: "test-channel",
        media_type: "hls",
        duration: 120,
        current_time: 60,
      }));
    });
  });

  describe("Event Tracking", () => {
    beforeEach(() => {
      mediaAnalytics.startSession("test-channel", "hls");
    });

    it("tracks play events", () => {
      mediaAnalytics.trackPlay(30);
      
      expect(mockMixpanel.track).toHaveBeenCalledWith("media_play", expect.objectContaining({
        current_time: 30,
      }));
    });

    it("tracks pause events", () => {
      mediaAnalytics.trackPause(45);
      
      expect(mockMixpanel.track).toHaveBeenCalledWith("media_pause", expect.objectContaining({
        current_time: 45,
      }));
    });

    it("tracks buffer start and end", () => {
      mediaAnalytics.trackBufferStart();
      
      expect(mockMixpanel.track).toHaveBeenCalledWith("media_buffer_start", expect.any(Object));
      
      mediaAnalytics.trackBufferEnd();
      
      expect(mockMixpanel.track).toHaveBeenCalledWith("media_buffer_end", expect.objectContaining({
        buffer_duration: expect.any(Number),
      }));
    });

    it("calculates buffer duration correctly", () => {
      vi.useFakeTimers();
      
      mediaAnalytics.trackBufferStart();
      
      // Simulate buffer time
      vi.advanceTimersByTime(2000);
      
      mediaAnalytics.trackBufferEnd();
      
      const lastCall = mockMixpanel.track.mock.calls[mockMixpanel.track.mock.calls.length - 1];
      expect(lastCall[1].buffer_duration).toBeGreaterThanOrEqual(2000);
      
      vi.useRealTimers();
    });

    it("tracks quality changes", () => {
      mediaAnalytics.trackQualityChange(720);
      
      expect(mockMixpanel.track).toHaveBeenCalledWith("media_quality_change", expect.objectContaining({
        quality_level: 720,
      }));
      
      const session = mediaAnalytics.getCurrentSession();
      expect(session?.qualityChanges).toBe(1);
    });

    it("tracks errors", () => {
      mediaAnalytics.trackError("Network error");
      
      expect(mockMixpanel.track).toHaveBeenCalledWith("media_error", expect.objectContaining({
        error_message: "Network error",
      }));
      
      const session = mediaAnalytics.getCurrentSession();
      expect(session?.errorCount).toBe(1);
    });

    it("tracks seek events", () => {
      mediaAnalytics.trackSeek(30, 60);
      
      expect(mockMixpanel.track).toHaveBeenCalledWith("media_seek", expect.objectContaining({
        seek_from: 30,
        seek_to: 60,
      }));
    });

    it("tracks completion events", () => {
      mediaAnalytics.trackComplete(120);
      
      expect(mockMixpanel.track).toHaveBeenCalledWith("media_complete", expect.objectContaining({
        duration: 120,
        current_time: 120,
      }));
      
      const session = mediaAnalytics.getCurrentSession();
      expect(session?.completionRate).toBe(100);
    });
  });

  describe("Session Metrics", () => {
    beforeEach(() => {
      mediaAnalytics.startSession("test-channel", "hls");
    });

    it("accumulates buffer time correctly", () => {
      vi.useFakeTimers();
      
      mediaAnalytics.trackBufferStart();
      vi.advanceTimersByTime(1000);
      mediaAnalytics.trackBufferEnd();
      
      mediaAnalytics.trackBufferStart();
      vi.advanceTimersByTime(1500);
      mediaAnalytics.trackBufferEnd();
      
      const session = mediaAnalytics.getCurrentSession();
      expect(session?.totalBufferTime).toBeGreaterThanOrEqual(2500);
      
      vi.useRealTimers();
    });

    it("counts buffer events", () => {
      mediaAnalytics.trackBufferStart();
      mediaAnalytics.trackBufferEnd();
      
      mediaAnalytics.trackBufferStart();
      mediaAnalytics.trackBufferEnd();
      
      const session = mediaAnalytics.getCurrentSession();
      expect(session?.bufferCount).toBe(2);
    });

    it("accumulates quality changes", () => {
      mediaAnalytics.trackQualityChange(480);
      mediaAnalytics.trackQualityChange(720);
      mediaAnalytics.trackQualityChange(1080);
      
      const session = mediaAnalytics.getCurrentSession();
      expect(session?.qualityChanges).toBe(3);
    });

    it("accumulates errors", () => {
      mediaAnalytics.trackError("Error 1");
      mediaAnalytics.trackError("Error 2");
      
      const session = mediaAnalytics.getCurrentSession();
      expect(session?.errorCount).toBe(2);
    });
  });

  describe("Edge Cases", () => {
    it("handles events without active session gracefully", () => {
      // Don't start a session
      expect(() => {
        mediaAnalytics.trackPlay(30);
        mediaAnalytics.trackPause(45);
        mediaAnalytics.trackBufferStart();
        mediaAnalytics.trackError("Test");
      }).not.toThrow();
    });

    it("handles buffer end without buffer start", () => {
      mediaAnalytics.startSession("test-channel", "hls");
      
      expect(() => {
        mediaAnalytics.trackBufferEnd();
      }).not.toThrow();
    });

    it("tracks different media types", () => {
      mediaAnalytics.startSession("test-channel", "mp4");
      
      expect(mockMixpanel.track).toHaveBeenCalledWith("media_session_start", expect.objectContaining({
        media_type: "mp4",
      }));
    });

    it("flushes queued events", () => {
      mediaAnalytics.startSession("test-channel", "hls");
      mediaAnalytics.trackPlay(30);
      expect((mediaAnalytics as any).eventQueue.length).toBeGreaterThan(0);

      // Called directly rather than by advancing fake timers: the flush interval
      // is registered in the constructor, and this module is a singleton, so the
      // timer is created at import time — before vi.useFakeTimers() could
      // capture it. Driving the timer here would test nothing.
      (mediaAnalytics as any).flushEvents();

      expect((mediaAnalytics as any).eventQueue).toHaveLength(0);
    });
  });

  describe("Cleanup", () => {
    it("destroys interval and flushes events on destroy", () => {
      vi.useFakeTimers();
      
      mediaAnalytics.startSession("test-channel", "hls");
      mediaAnalytics.trackPlay(30);
      
      mediaAnalytics.destroy();
      
      expect((mediaAnalytics as any).flushInterval).toBeNull();
      expect((mediaAnalytics as any).eventQueue).toHaveLength(0);
      
      vi.useRealTimers();
    });
  });
});