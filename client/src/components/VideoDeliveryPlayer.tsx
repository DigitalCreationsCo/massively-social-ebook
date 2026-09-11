import Hls from "hls.js";
import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { mediaAnalytics } from "@/lib/media-analytics";
import { CenterPlayButton, MediaControls, type PlayerState } from "./MediaControls";

interface VideoDeliveryPlayerProps {
  manifestUrl?: string | null;
  isLive: boolean;
  channelId?: string;
  className?: string;
}

const MAX_RECONNECT_ATTEMPTS = 3;

function canPlayNativeHls(video: HTMLVideoElement) {
  return Boolean(video.canPlayType("application/vnd.apple.mpegurl") || video.canPlayType("application/x-mpegURL"));
}

export function VideoDeliveryPlayer({ 
  manifestUrl, 
  isLive, 
  channelId = "default",
  className 
}: VideoDeliveryPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stabilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const manifestRef = useRef<string | null | undefined>(manifestUrl);
  const [sourceVersion, setSourceVersion] = useState(0);
  const [playerState, setPlayerState] = useState<PlayerState>(manifestUrl ? "loading" : "idle");
  const [isMuted, setIsMuted] = useState(true);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [areControlsVisible, setAreControlsVisible] = useState(true);
  const controlsFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analyticsSessionIdRef = useRef<string | null>(null);
  // Last decoded frame, shown as a poster overlay while the stream stalls
  // or reconnects so the previous image holds indefinitely instead of black.
  const [heldFrame, setHeldFrame] = useState<string | null>(null);
  const mediaErrorRecoveryRef = useRef(false);

  const captureHeldFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setHeldFrame(canvas.toDataURL("image/jpeg", 0.7));
    } catch {
      // Cross-origin segments taint the canvas; fall back to holding the
      // live <video> element itself (don't destroy src) instead of a snapshot.
    }
  }, []);

  // Detect media type from URL
  const mediaType = manifestUrl?.endsWith('.m3u8') ? 'hls' : 
                    manifestUrl?.endsWith('.mp4') ? 'mp4' : 'other';

  const scheduleReconnect = useCallback(() => {
    if (stabilityTimerRef.current) {
      clearTimeout(stabilityTimerRef.current);
      stabilityTimerRef.current = null;
    }
    if (reconnectTimerRef.current) return;
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      setPlayerState("error");
      mediaAnalytics.trackError("Max reconnection attempts reached");
      return;
    }
    const attempt = reconnectAttemptsRef.current++;
    setPlayerState("reconnecting");
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      setSourceVersion((version) => version + 1);
    }, Math.min(1_000 * 2 ** attempt, 8_000));
  }, []);

  const attemptPlayback = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
      setPlayerState("playing");
      setHeldFrame(null);
      mediaErrorRecoveryRef.current = false;
      mediaAnalytics.trackPlay(video.currentTime);
      if (stabilityTimerRef.current) clearTimeout(stabilityTimerRef.current);
      stabilityTimerRef.current = setTimeout(() => {
        reconnectAttemptsRef.current = 0;
        stabilityTimerRef.current = null;
      }, 30_000);
    } catch {
      // A manual control is more useful than treating an autoplay policy as failure.
      setPlayerState("paused");
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !manifestUrl) {
      setPlayerState("idle");
      return;
    }

    let disposed = false;
    if (manifestRef.current !== manifestUrl) {
      manifestRef.current = manifestUrl;
      reconnectAttemptsRef.current = 0;
    }
    setPlayerState("loading");
    video.muted = true;
    video.playsInline = true;
    const startPlayback = () => { if (!disposed) void attemptPlayback(); };
    const handleNativeError = () => { if (!disposed) { captureHeldFrame(); scheduleReconnect(); } };

    if (canPlayNativeHls(video)) {
      video.src = manifestUrl;
      video.addEventListener("canplay", startPlayback, { once: true });
      video.addEventListener("error", handleNativeError);
      video.load();
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        // Join a live broadcast at the current/recent segment rather than
        // replaying a large portion of its retained manifest on page load.
        // Two segments leaves enough room for HLS jitter without adding a
        // visible delay to a newly connected viewer.
        startPosition: -1,
        liveSyncDurationCount: 2,
        maxLiveSyncPlaybackRate: 1.25,
        maxBufferLength: 30,
        liveMaxLatencyDurationCount: 5,
        manifestLoadingMaxRetry: 3,
        levelLoadingMaxRetry: 3,
        fragLoadingMaxRetry: 4,
      });
      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, startPlayback);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (disposed) return;
        // Transient stalls/retries are handled internally by hls.js —
        // hold the last frame and let it recover without tearing down.
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaErrorRecoveryRef.current) {
          mediaErrorRecoveryRef.current = true;
          captureHeldFrame();
          try {
            hls.recoverMediaError();
            return;
          } catch {
            // fall through to reconnect
          }
        }
        captureHeldFrame();
        scheduleReconnect();
      });
      hls.loadSource(manifestUrl);
      hls.attachMedia(video);
    } else {
      setPlayerState("error");
    }

    // Start analytics session when HLS is ready
    if (!analyticsSessionIdRef.current) {
      analyticsSessionIdRef.current = mediaAnalytics.startSession(channelId, mediaType);
    }

    return () => {
      disposed = true;
      // Snapshot before teardown so the reconnect still shows the last image.
      captureHeldFrame();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (stabilityTimerRef.current) {
        clearTimeout(stabilityTimerRef.current);
        stabilityTimerRef.current = null;
      }
      video.removeEventListener("canplay", startPlayback);
      video.removeEventListener("error", handleNativeError);
      // Only fully unload when the manifest itself changed or unmounting —
      // reconnect retries (sourceVersion bumps) reuse the same element.
      video.pause();
      video.removeAttribute("src");
      video.load();
      hlsRef.current?.destroy();
      hlsRef.current = null;
      
      // End analytics session
      if (analyticsSessionIdRef.current) {
        mediaAnalytics.endSession(video.duration, video.currentTime);
        analyticsSessionIdRef.current = null;
      }
    };
  }, [attemptPlayback, manifestUrl, scheduleReconnect, sourceVersion, channelId, mediaType, captureHeldFrame]);

  const handlePlaybackToggle = async (event?: MouseEvent<HTMLButtonElement>) => {
    event?.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      await attemptPlayback();
    } else {
      video.pause();
      setPlayerState("paused");
      mediaAnalytics.trackPause(video.currentTime);
    }
  };

  const toggleMute = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setIsMuted(nextMuted);
    if (video.paused) await attemptPlayback();
  };

  const toggleFullScreen = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const container = containerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen().catch((error) => {
        console.error("Error attempting to enable full screen:", error);
      });
    } else {
      document.exitFullscreen();
    }
  };

  const showControls = useCallback(() => {
    setAreControlsVisible(true);
    if (controlsFadeTimerRef.current) {
      clearTimeout(controlsFadeTimerRef.current);
      controlsFadeTimerRef.current = null;
    }
    controlsFadeTimerRef.current = setTimeout(() => {
      setAreControlsVisible(false);
      controlsFadeTimerRef.current = null;
    }, 6000);
  }, []);

  const handleContainerMouseEnter = useCallback(() => {
    showControls();
  }, [showControls]);

  const handleContainerMouseMove = useCallback(() => {
    showControls();
  }, [showControls]);

  const handleContainerFocus = useCallback(() => {
    showControls();
  }, [showControls]);

  const handleContainerMouseLeave = useCallback(() => {
    if (controlsFadeTimerRef.current) {
      clearTimeout(controlsFadeTimerRef.current);
      controlsFadeTimerRef.current = null;
    }
    setAreControlsVisible(false);
  }, []);

  useEffect(() => {
    const handleFullScreenChange = () => {
      setIsFullScreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullScreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullScreenChange);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (controlsFadeTimerRef.current) {
        clearTimeout(controlsFadeTimerRef.current);
        controlsFadeTimerRef.current = null;
      }
    };
  }, []);

  const isUnavailable = !manifestUrl;
  const isBusy = playerState === "loading" || playerState === "reconnecting";
  const shouldShowPlay = playerState === "paused" || playerState === "error";

  return (
    <div
      ref={containerRef}
      className={cn("group relative isolate", isFullScreen ? "rounded-none border-none" : "", className)}
      role={isUnavailable ? undefined : "group"}
      aria-label={isUnavailable ? undefined : "Video delivery player"}
      tabIndex={isUnavailable ? undefined : 0}
      onMouseEnter={handleContainerMouseEnter}
      onMouseMove={handleContainerMouseMove}
      onMouseLeave={handleContainerMouseLeave}
      onFocus={handleContainerFocus}
    >
      {!isUnavailable && (
        <>
        <video 
          ref={videoRef} 
          muted 
          autoPlay 
          playsInline 
          className="relative size-full object-cover transition-opacity duration-700" 
          aria-label="Media player video" 
          onPlay={() => {
            setPlayerState("playing");
            setHeldFrame(null);
            mediaAnalytics.trackPlay(videoRef.current?.currentTime);
          }} 
          onPause={() => {
            if (playerState !== "loading" && playerState !== "reconnecting") {
              setPlayerState("paused");
              mediaAnalytics.trackPause(videoRef.current?.currentTime);
            }
          }}
          onEnded={() => {
            setPlayerState("paused");
            const duration = videoRef.current?.duration;
            if (duration) {
              mediaAnalytics.trackComplete(duration);
            }
          }}
          onError={() => {
            captureHeldFrame();
            mediaAnalytics.trackError("Video playback error");
            scheduleReconnect();
          }}
          onWaiting={() => {
            captureHeldFrame();
            // HLS can remain attached and report a regular buffer wait (rather
            // than a fatal error) when the queue has not produced the next
            // segment yet. Treat it as a visible stall so the last decoded
            // image stays on screen instead of exposing the video's black
            // canvas until playout resumes.
            setPlayerState("reconnecting");
            mediaAnalytics.trackBufferStart();
          }}
          onPlaying={() => {
            setHeldFrame(null);
            mediaAnalytics.trackBufferEnd();
          }}
        />
        {heldFrame && isBusy && (
          <img
            src={heldFrame}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 size-full object-cover"
            draggable={false}
          />
        )}
        </>
      )}

      {isUnavailable ? (
        <div className="relative flex size-full flex-col items-center justify-center px-3 text-center">
          <span className="mb-2 font-mono text-[10px] uppercase tracking-[0.32em] text-white/75">Signal pending</span>
          <h1 className="max-w-lg font-serif font-semibold text-2xl leading-tight text-white sm:text-3xl">This channel is preparing to air.</h1>
        </div>
      ) : (
        <>
          <MediaControls
            playerState={playerState}
            isMuted={isMuted}
            isLive={isLive}
            isBusy={isBusy}
            isFullScreen={isFullScreen}
            onPlaybackToggle={handlePlaybackToggle}
            onToggleMute={toggleMute}
            onToggleFullScreen={toggleFullScreen}
            className={cn("transition-opacity duration-500", areControlsVisible || isFullScreen ? "opacity-100" : "opacity-0")}
          />
          <CenterPlayButton
            playerState={playerState}
            isBusy={isBusy}
            onPlaybackToggle={handlePlaybackToggle}
          />
        </>
      )}
    </div>
  );
}
