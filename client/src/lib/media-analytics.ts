/**
 * Media Analytics Module
 * 
 * Tracks engagement metrics, watch time, buffer events, quality changes, and other
 * media player analytics for the industry-standard media player.
 */

export interface MediaAnalyticsEvent {
  eventType: 'session_start' | 'session_end' | 'play' | 'pause' | 'buffer_start' | 'buffer_end' | 'quality_change' | 'error' | 'seek' | 'complete';
  timestamp: number;
  sessionId: string;
  channelId: string;
  mediaType: 'hls' | 'mp4' | 'other';
  data?: {
    duration?: number;
    currentTime?: number;
    qualityLevel?: number;
    errorMessage?: string;
    bufferDuration?: number;
    seekFrom?: number;
    seekTo?: number;
  };
}

export interface MediaAnalyticsSession {
  sessionId: string;
  channelId: string;
  startTime: number;
  endTime?: number;
  totalWatchTime: number;
  totalBufferTime: number;
  bufferCount: number;
  qualityChanges: number;
  errorCount: number;
  completionRate: number;
}

class MediaAnalytics {
  private currentSession: MediaAnalyticsSession | null = null;
  private currentBufferStart: number | null = null;
  private eventQueue: MediaAnalyticsEvent[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private isMixpanelAvailable: boolean;

  constructor() {
    this.isMixpanelAvailable = typeof window !== 'undefined' && !!(window as any).mixpanel;
    this.startFlushInterval();
  }

  private startFlushInterval() {
    // Flush events every 30 seconds
    this.flushInterval = setInterval(() => {
      this.flushEvents();
    }, 30000);
  }

  private generateSessionId(): string {
    return `media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  startSession(channelId: string, mediaType: 'hls' | 'mp4' | 'other' = 'hls'): string {
    const sessionId = this.generateSessionId();
    
    this.currentSession = {
      sessionId,
      channelId,
      startTime: Date.now(),
      totalWatchTime: 0,
      totalBufferTime: 0,
      bufferCount: 0,
      qualityChanges: 0,
      errorCount: 0,
      completionRate: 0,
    };

    this.trackEvent({
      eventType: 'session_start',
      timestamp: Date.now(),
      sessionId,
      channelId,
      mediaType,
    });

    return sessionId;
  }

  endSession(duration?: number, currentTime?: number) {
    if (!this.currentSession) return;

    const endTime = Date.now();
    this.currentSession.endTime = endTime;
    this.currentSession.totalWatchTime = endTime - this.currentSession.startTime;
    
    if (duration && currentTime) {
      this.currentSession.completionRate = (currentTime / duration) * 100;
    }

    this.trackEvent({
      eventType: 'session_end',
      timestamp: endTime,
      sessionId: this.currentSession.sessionId,
      channelId: this.currentSession.channelId,
      mediaType: 'hls', // Default, should be tracked properly
      data: {
        duration,
        currentTime,
      },
    });

    this.flushEvents();
    this.currentSession = null;
  }

  trackPlay(currentTime?: number) {
    if (!this.currentSession) return;

    this.trackEvent({
      eventType: 'play',
      timestamp: Date.now(),
      sessionId: this.currentSession.sessionId,
      channelId: this.currentSession.channelId,
      mediaType: 'hls',
      data: { currentTime },
    });
  }

  trackPause(currentTime?: number) {
    if (!this.currentSession) return;

    this.trackEvent({
      eventType: 'pause',
      timestamp: Date.now(),
      sessionId: this.currentSession.sessionId,
      channelId: this.currentSession.channelId,
      mediaType: 'hls',
      data: { currentTime },
    });
  }

  trackBufferStart() {
    if (!this.currentSession) return;
    
    this.currentBufferStart = Date.now();
    this.currentSession.bufferCount++;

    this.trackEvent({
      eventType: 'buffer_start',
      timestamp: Date.now(),
      sessionId: this.currentSession.sessionId,
      channelId: this.currentSession.channelId,
      mediaType: 'hls',
    });
  }

  trackBufferEnd() {
    if (!this.currentSession || !this.currentBufferStart) return;

    const bufferDuration = Date.now() - this.currentBufferStart;
    this.currentSession.totalBufferTime += bufferDuration;
    this.currentBufferStart = null;

    this.trackEvent({
      eventType: 'buffer_end',
      timestamp: Date.now(),
      sessionId: this.currentSession.sessionId,
      channelId: this.currentSession.channelId,
      mediaType: 'hls',
      data: { bufferDuration },
    });
  }

  trackQualityChange(qualityLevel: number) {
    if (!this.currentSession) return;

    this.currentSession.qualityChanges++;

    this.trackEvent({
      eventType: 'quality_change',
      timestamp: Date.now(),
      sessionId: this.currentSession.sessionId,
      channelId: this.currentSession.channelId,
      mediaType: 'hls',
      data: { qualityLevel },
    });
  }

  trackError(errorMessage: string) {
    if (!this.currentSession) return;

    this.currentSession.errorCount++;

    this.trackEvent({
      eventType: 'error',
      timestamp: Date.now(),
      sessionId: this.currentSession.sessionId,
      channelId: this.currentSession.channelId,
      mediaType: 'hls',
      data: { errorMessage },
    });
  }

  trackSeek(seekFrom: number, seekTo: number) {
    if (!this.currentSession) return;

    this.trackEvent({
      eventType: 'seek',
      timestamp: Date.now(),
      sessionId: this.currentSession.sessionId,
      channelId: this.currentSession.channelId,
      mediaType: 'hls',
      data: { seekFrom, seekTo },
    });
  }

  trackComplete(duration: number) {
    if (!this.currentSession) return;

    this.currentSession.completionRate = 100;

    this.trackEvent({
      eventType: 'complete',
      timestamp: Date.now(),
      sessionId: this.currentSession.sessionId,
      channelId: this.currentSession.channelId,
      mediaType: 'hls',
      data: { duration, currentTime: duration },
    });
  }

  private trackEvent(event: MediaAnalyticsEvent) {
    this.eventQueue.push(event);
    
    // Track to Mixpanel if available
    if (this.isMixpanelAvailable) {
      try {
        (window as any).mixpanel.track(`media_${event.eventType}`, {
          session_id: event.sessionId,
          channel_id: event.channelId,
          media_type: event.mediaType,
          ...event.data,
        });
      } catch (error) {
        console.warn('Failed to track media event to Mixpanel:', error);
      }
    }
  }

  private flushEvents() {
    if (this.eventQueue.length === 0) return;

    // In production, you would send these to your analytics backend
    // For now, we'll just log them for debugging
    if (process.env.NODE_ENV === 'development') {
      console.log('Media Analytics Events:', this.eventQueue);
    }

    this.eventQueue = [];
  }

  getCurrentSession(): MediaAnalyticsSession | null {
    return this.currentSession;
  }

  destroy() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flushEvents();
  }
}

// Singleton instance
export const mediaAnalytics = new MediaAnalytics();