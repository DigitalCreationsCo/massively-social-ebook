import { BlockWithChats } from "@/hooks/use-session-replay";
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
import React, { useCallback, useEffect, useRef, useState } from "react";

interface ReplayProps {
  blocks: BlockWithChats[];
  session?: Session;
  onPlay?: () => void;
}

function ChatBubble({
  msg,
  index,
  blockIndex,
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
}: {
  story: BlockWithChats;
  blockIndex: number;
}) {
  const frame = useCurrentFrame();

  const scale = interpolate(frame, [0, 180], [1, 1.1]);

  return (
    <AbsoluteFill>
      <Img
        src={story.imageUrl || ""}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale})`,
        }}
      />

      {/* overlay */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.75), transparent 60%)",
        }}
      />

      {/* text */}
      <div
        className="border"
        style={{
          position: "absolute",
          bottom: 0,
          left: 80,
          right: 80,
          color: "white",
        }}
      >
        {/* <h1 style={ { fontSize: 72, fontWeight: 700 } }>
                    { story.title }
                </h1> */}
        {story.content && (
          <p style={{ fontSize: 48, opacity: 0.85 }}>{story.content}</p>
        )}
      </div>

      {/* chat overlay */}
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
    </AbsoluteFill>
  );
}

export const Replay = ({ blocks, session, onPlay }: ReplayProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const playerRef = useRef<PlayerRef>(null);

  const [isIntersecting, setIsIntersecting] = useState(false);
  const callback: IntersectionObserverCallback = useCallback(
    (newData) => {
      setIsIntersecting(newData[0].isIntersecting);
      if (isIntersecting) {
        playerRef.current?.play();
        onPlay?.();
      } else {
        playerRef.current?.pause();
      }
    },
    [isIntersecting],
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

  const FPS = 30;
  const MIN_BLOCK_FRAMES = 2 * FPS; // 60 frames  (2s)
  const MAX_BLOCK_FRAMES = 5 * FPS; // 150 frames (5s)
  const TARGET_TOTAL_FRAMES = 17.5 * FPS; // aim for ~17.5s midpoint

  const perBlockFrames =
    blocks.length > 0
      ? Math.min(
          MAX_BLOCK_FRAMES,
          Math.max(
            MIN_BLOCK_FRAMES,
            Math.round(TARGET_TOTAL_FRAMES / blocks.length),
          ),
        )
      : MIN_BLOCK_FRAMES;

  const totalFrames = perBlockFrames * blocks.length;

  const Component = () => (
    <AbsoluteFill>
      {blocks.map((block, blockIndex) => (
        <Sequence
          key={blockIndex}
          from={blockIndex * perBlockFrames}
          durationInFrames={perBlockFrames}
        >
          <StoryScene story={block} blockIndex={blockIndex} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );

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
        fps={30}
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
};
