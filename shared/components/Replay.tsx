import { BlockWithChats } from "@shared/replay-cache";
import { Session, ChatMessage } from "@shared/schema";
import {
  AbsoluteFill,
  Img,
  interpolate,
  Sequence,
  useCurrentFrame,
} from "remotion";
import type { PlayerRef } from "@remotion/player";
import { Player } from "@remotion/player";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

export interface ReplayHandle {
  /**
   * Captures the current Remotion Player canvas as a video file
   * and triggers a browser download. Plays through the full video in
   * real time to capture all frames.
   */
  downloadVideo: () => Promise<void>;
}

interface ReplayProps {
  blocks: BlockWithChats[];
  session?: Session;
  onPlay?: () => void;
}

const FPS = 30;
const SPLASH_FRAMES = 4 * FPS; // 4 seconds
const FINAL_BLOCK_BONUS_FRAMES = 1 * FPS; // +1s extra for the last block
const FADE_OUT_FRAMES = 10; // abrupt fade-to-black at the very end

// ── Helpers ────────────────────────────────────────────────────────────

/** Deterministic pseudo-random in [0, 1) from an integer seed. */
function hash(seed: number): number {
  // Simple LCG
  return ((seed * 1103515245 + 12345) >>> 0) / 0x100000000;
}

/** Per-block display duration in frames (3.5–5 s). Notable blocks skew longer. The final block gets a bonus for suspense. */
function getBlockDuration(
  index: number,
  isNotable: boolean,
  isLast: boolean,
): number {
  const minSec = 3.5;
  const maxSec = 5.0;

  const jitter = hash(index * 7919); // deterministic 0..1

  const base = isNotable ? 4.0 + jitter * 1.0 : 3.5 + jitter * 1.5;

  const clamped = Math.max(minSec, Math.min(maxSec, base));
  let frames = Math.round(clamped * FPS);
  if (isLast) frames += FINAL_BLOCK_BONUS_FRAMES;
  return frames;
}

/**
 * Subtle hand-camera offset for a given block+frame combo.
 * Only the background image moves — text and overlays stay stable.
 */
function handcamOffset(
  blockIndex: number,
  frame: number,
): { x: number; y: number; rotate: number; breathe: number } {
  const s1 = blockIndex * 100 + frame;
  return {
    x: Math.sin(s1 * 0.07 + hash(blockIndex) * 10) * 0.6,
    y: Math.cos(s1 * 0.05 + hash(blockIndex + 100) * 10) * 0.3,
    rotate: Math.sin(s1 * 0.03 + hash(blockIndex + 200) * 10) * 0.08,
    breathe: 1 + Math.sin(s1 * 0.02 + hash(blockIndex + 300) * 10) * 0.0006,
  };
}

// ── Scenes ─────────────────────────────────────────────────────────────

function SplashScene() {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [0, 30], [0, 1], {
    extrapolateRight: "clamp",
  });
  const scale = interpolate(frame, [0, 30], [1.08, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "black",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          opacity,
          transform: `scale(${scale})`,
          color: "white",
          fontSize: 72,
          fontFamily: '"Playfair Display", serif',
          letterSpacing: "0.05em",
        }}
      >
        Previously...
      </div>
    </AbsoluteFill>
  );
}

function ChatBubble({
  msg,
  frame,
}: {
  msg: ChatMessage;
  index: number;
  blockIndex: number;
  frame: number;
}) {
  const localFrame = frame;

  const visible = localFrame >= 0;

  const opacity = interpolate(localFrame, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
  });

  const translateY = interpolate(localFrame, [0, 10], [20, 0], {
    extrapolateLeft: "clamp",
  });

  if (!visible) return null;

  return (
    <div
      style={{
        marginBottom: 14,
        opacity,
        transform: `translateY(${translateY}px)`,
        background: "rgba(0,0,0,0.55)",
        padding: "14px 18px",
        borderRadius: 18,
        color: "white",
        maxWidth: 520,
        backdropFilter: "blur(8px)",
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 600, opacity: 0.8 }}>
        {msg.username}
      </div>
      <div style={{ fontSize: 22 }}>{msg.text}</div>
    </div>
  );
}

function StoryScene({
  story,
  blockIndex,
  durationInFrames,
  isLastBlock,
}: {
  story: BlockWithChats;
  blockIndex: number;
  durationInFrames: number;
  isLastBlock: boolean;
}) {
  const frame = useCurrentFrame();
  const { x, y, rotate, breathe } = handcamOffset(blockIndex, frame);

  // Fade from black at the start of each block
  const fadeIn = interpolate(frame, [0, 15], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Abrupt fade to black at the very end of the final block
  const endFadeOut =
    isLastBlock && durationInFrames > FADE_OUT_FRAMES
      ? interpolate(
          frame,
          [durationInFrames - FADE_OUT_FRAMES, durationInFrames],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        )
      : 0;

  return (
    <AbsoluteFill>
      {/* ── Background image with subtle handcam movement ── */}
      <Img
        src={story.imageUrl || ""}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `translate(${x}px, ${y}px) scale(${breathe}) rotate(${rotate}deg)`,
        }}
      />

      {/* ── Gradient overlay (stable) ── */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.75), transparent 60%)",
        }}
      />

      {/* ── Content text (stable) — uses Inter sans font ── */}
      <div
        style={{
          position: "absolute",
          bottom: 40,
          left: 80,
          right: 80,
          color: "white",
        }}
      >
        {story.content && (
          <p
            style={{
              fontSize: "3rem",
              margin: 0,
              fontFamily: '"Inter", sans-serif',
            }}
          >
            {story.content}
          </p>
        )}
      </div>

      {/* ── Chat bubbles (stable) ── */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 80,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {story.chats?.map((msg, i) => (
          <ChatBubble
            key={i}
            msg={msg}
            index={i}
            blockIndex={blockIndex}
            frame={frame}
          />
        ))}
      </div>

      {/* ── Fade-from-black overlay (block start) ── */}
      {fadeIn > 0 && (
        <AbsoluteFill
          style={{
            backgroundColor: `rgba(0,0,0,${fadeIn})`,
            pointerEvents: "none",
          }}
        />
      )}

      {/* ── Abrupt fade-to-black overlay (final block end) ── */}
      {isLastBlock && endFadeOut > 0 && (
        <AbsoluteFill
          style={{
            backgroundColor: `rgba(0,0,0,${endFadeOut})`,
            pointerEvents: "none",
          }}
        />
      )}
    </AbsoluteFill>
  );
}

/** Brief full-black scene for the abrupt fade-out tail. */
function FinalFadeScene() {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, FADE_OUT_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ backgroundColor: `rgba(0,0,0,${opacity})` }} />
  );
}

// ── Player wrapper ─────────────────────────────────────────────────────

export const Replay = forwardRef<ReplayHandle, ReplayProps>(
  ({ blocks, onPlay }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<PlayerRef>(null);
  const onPlayRef = useRef(onPlay);
  onPlayRef.current = onPlay; // always fresh, no re-render cascade

  // const [isIntersecting, setIsIntersecting] = useState(false);

  // ── Preload block images before the Player renders ──
  const [imagesReady, setImagesReady] = useState(false);
  useEffect(() => {
    const urls = blocks
      .map((b) => b.imageUrl)
      .filter((url): url is string => !!url);

    if (urls.length === 0) {
      setImagesReady(true);
      return;
    }

    let loaded = 0;
    let cancelled = false;

    const onLoad = () => {
      loaded++;
      if (!cancelled && loaded >= urls.length) {
        setImagesReady(true);
      }
    };

    for (const url of urls) {
      const img = new Image();
      img.onload = onLoad;
      img.onerror = onLoad; // don't block on failed images
      img.src = url;
    }

    return () => {
      cancelled = true;
    };
  }, [blocks]);

  // Use the observer entry directly (not stale state) and read onPlay via ref
  // so the callback never needs to be recreated.
  const callback: IntersectionObserverCallback = useCallback(
    (newData) => {
      const intersecting = newData[0].isIntersecting;
      // setIsIntersecting(intersecting);
      if (intersecting) {
        playerRef.current?.play();
        onPlayRef.current?.();
      } else {
        playerRef.current?.pause();
      }
    },
    [], // stable — never recreated
  );

  useEffect(() => {
    const { current } = containerRef;
    if (!current) {
      return;
    }

    const observer = new IntersectionObserver(callback, {
      root: null,
      threshold: 1,
    });
    observer.observe(current);

    return () => observer.unobserve(current);
  }, [callback]);

  // ── Compute per-block durations (deterministic) ──
  const blockDurations = useMemo(
    () =>
      blocks.map((block, i) =>
        getBlockDuration(i, block.isNotable ?? false, i === blocks.length - 1),
      ),
    [blocks],
  );

  // Total frames = splash + all blocks + fade-out tail
  const totalFrames =
    blockDurations.reduce((sum, d) => sum + d, 0) + SPLASH_FRAMES +
      FADE_OUT_FRAMES || 1;

  // Cumulative start positions for each block (after splash)
  const cumulativeStarts = useMemo(() => {
    let running = SPLASH_FRAMES;
    return blockDurations.map((d) => {
      const start = running;
      running += d;
      return start;
    });
  }, [blockDurations]);

  // Frame at which the fade-out tail begins
  const fadeOutStart = totalFrames - FADE_OUT_FRAMES;

  const Component = useCallback(
    () => (
      <AbsoluteFill>
        {/* Splash screen first */}
        <Sequence from={0} durationInFrames={SPLASH_FRAMES}>
          <SplashScene />
        </Sequence>

        {/* Then each story block with its own variable duration */}
        {blocks.map((block, blockIndex) => (
          <Sequence
            key={blockIndex}
            from={cumulativeStarts[blockIndex]}
            durationInFrames={blockDurations[blockIndex]}
          >
            <StoryScene
              story={block}
              blockIndex={blockIndex}
              durationInFrames={blockDurations[blockIndex]}
              isLastBlock={blockIndex === blocks.length - 1}
            />
          </Sequence>
        ))}

        {/* Abrupt fade-to-black tail after the final block */}
        <Sequence from={fadeOutStart} durationInFrames={FADE_OUT_FRAMES}>
          <FinalFadeScene />
        </Sequence>
      </AbsoluteFill>
    ),
    [blocks, blockDurations, cumulativeStarts, fadeOutStart],
  );

  // ── Expose downloadVideo via ref ──
  useImperativeHandle(
    ref,
    () => ({
      downloadVideo: async (): Promise<void> => {
        // Wait for the Player's canvas to be in the DOM (images
        // preloading, Player mount, and Remotion canvas creation
        // are all async).  Poll up to 30 s so the button works even
        // when clicked before the Player is fully ready.
        let canvas: HTMLCanvasElement | null = null;
        for (let attempt = 0; attempt < 300; attempt++) {
          canvas =
            containerRef.current?.querySelector<HTMLCanvasElement>(
              "canvas",
            ) ?? null;
          if (canvas) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        if (!canvas) {
          throw new Error(
            "Player canvas not available – the player may have failed to initialise",
          );
        }

        // Capture the canvas as a video stream at the replay's FPS
        const stream = canvas.captureStream(FPS);

        // Pick the best supported container format
        const mimeType = MediaRecorder.isTypeSupported(
          "video/webm;codecs=vp9",
        )
          ? "video/webm;codecs=vp9"
          : MediaRecorder.isTypeSupported("video/webm")
            ? "video/webm"
            : "video/mp4";

        return new Promise<void>((resolve, reject) => {
          const chunks: Blob[] = [];

          const recorder = new MediaRecorder(stream, { mimeType });

          recorder.ondataavailable = (e: BlobEvent) => {
            if (e.data.size > 0) chunks.push(e.data);
          };

          recorder.onerror = () => {
            stream.getTracks().forEach((t) => t.stop());
            reject(new Error("Video recording failed"));
          };

          recorder.onstop = () => {
            stream.getTracks().forEach((t) => t.stop());
            const blob = new Blob(chunks, { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `session-replay.${mimeType.includes("mp4") ? "mp4" : "webm"}`;
            a.click();
            URL.revokeObjectURL(url);
            resolve();
          };

          // Start recording
          recorder.start();

          // Listen for when the player finishes
          const onEnded = () => {
            playerRef.current?.removeEventListener("ended", onEnded);
            recorder.stop();
          };

          playerRef.current?.addEventListener("ended", onEnded);

          // Seek to start and begin playback to feed frames into the recorder
          playerRef.current?.seekTo(0);
          playerRef.current?.play();
        });
      },
    }),
    [totalFrames],
  );

  // Nothing meaningful to show — bail
  if (totalFrames <= SPLASH_FRAMES + FADE_OUT_FRAMES) return null;

  // Hold on a black frame until images are preloaded
  if (!imagesReady) {
    return <div ref={containerRef} className="w-full h-full bg-black" />;
  }

  return (
    <div ref={containerRef} className="w-full h-full">
      <Player
        ref={playerRef}
        acknowledgeRemotionLicense
        component={Component}
        compositionWidth={1280}
        compositionHeight={720}
        clickToPlay={true}
        spaceKeyToPlayOrPause={false}
        durationInFrames={totalFrames}
        fps={FPS}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          border: "1px solid rgba(0, 0, 0, 0.4)",
          borderRadius: 5,
        }}
      />
    </div>
  );
});
