import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { type MouseEvent } from "react";
import { cn } from "@/lib/utils";

export type PlayerState = "idle" | "loading" | "playing" | "paused" | "reconnecting" | "error";

interface PlainMediaControlsProps {
  playerState: PlayerState;
  isMuted: boolean;
  isLive: boolean;
  isBusy: boolean;
  isFullScreen: boolean;
  onPlaybackToggle: (event?: MouseEvent<HTMLButtonElement>) => void;
  onToggleMute: (event: MouseEvent<HTMLButtonElement>) => void;
  onToggleFullScreen: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  /** Style overrides so consumers can apply their own theme. */
  classNames?: {
    playButton?: string;
    iconButton?: string;
    centerButton?: string;
  };
}

/**
 * Plain, unthemed media controls. This is the shape intended for
 * `@portalshq/capability-video-delivery/react`: structural layout only,
 * neutral black/white colors, no application theme. Consumers style it
 * via `className` and `classNames`.
 */
export function PlainMediaControls(props: PlainMediaControlsProps) {
  const {
    playerState,
    isMuted,
    isLive,
    isFullScreen,
    onPlaybackToggle,
    onToggleMute,
    onToggleFullScreen,
    className,
    classNames,
  } = props;
  const shouldShowPlay = playerState === "paused" || playerState === "error";
  const hintText = playerState === "error"
      ? "Signal could not be restored"
      : isMuted
        ? "Tap audio to join in"
        : "";

  return (
    <div className={cn("absolute w-[80px] h-[200px] left-2 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-2", className)}>
      {isLive && <p className="font-mono text-[10px] animate-pulse uppercase tracking-[0.23em] text-white">Live</p>}
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={(event) => onPlaybackToggle(event)}
          // disabled={isBusy}
          className={cn("grid size-5 place-items-center rounded-full bg-white text-black shadow-[0_0_24px_rgba(0,0,0,0.35)] transition disabled:cursor-wait disabled:opacity-65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black", classNames?.playButton)}
          aria-label={playerState === "playing" ? "Pause broadcast" : "Play broadcast"}
        >
          {!shouldShowPlay ? <Pause className="size-3 fill-black" /> : <Play className="size-3 fill-black translate-x-px" />}
        </button>
        <button
          type="button"
          onClick={onToggleMute}
          className={cn("grid size-5 place-items-center rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white", classNames?.iconButton)}
          aria-label={isMuted ? "Turn sound on" : "Mute broadcast"}
        >
          {isMuted ? <VolumeX className="size-3" /> : <Volume2 className="size-3" />}
        </button>
        <button
          type="button"
          onClick={onToggleFullScreen}
          className={cn("grid size-5 place-items-center rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white", classNames?.iconButton)}
          aria-label={isFullScreen ? "Exit full screen" : "Enter full screen"}
        >
          {isFullScreen ? <Minimize className="size-3" /> : <Maximize className="size-3" />}
        </button>
      </div>
      {hintText && <p className="max-w-[76px] text-center text-[11px] leading-tight text-white">{hintText}</p>}
    </div>
  );
}

interface MediaControlsProps extends PlainMediaControlsProps {}

/**
 * Application-themed controls. This keeps the previous gold styling
 * in the application, on top of the plain package-shaped component,
 * so any consumer can supply its own theme instead.
 */
export function MediaControls(props: MediaControlsProps) {
  return (
    <PlainMediaControls
      {...props}
      classNames={{
        playButton:
          "bg-primary text-primary-foreground shadow-[0_0_24px_rgba(251,191,36,0.32)] focus-visible:ring-primary",
        iconButton: "focus-visible:ring-primary",
      }}
    />
  );
}

interface CenterPlayButtonProps {
  playerState: PlayerState;
  isBusy: boolean;
  onPlaybackToggle: (event?: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}

/** Plain center-play overlay: neutral black/white, no application theme. */
export function PlainCenterPlayButton({ playerState, onPlaybackToggle, className }: CenterPlayButtonProps) {
  const shouldShowPlay = playerState === "paused" || playerState === "error";

  if (!shouldShowPlay) return null;

  return (
    <button
      type="button"
      onClick={(event) => onPlaybackToggle(event)}
      className={cn("absolute inset-0 grid place-items-center bg-black/20 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100", className)}
      aria-label="Resume live broadcast"
    >
      <span className="grid size-8 place-items-center rounded-full border border-white/55 bg-black/65 text-white shadow-[0_0_36px_rgba(0,0,0,0.35)] backdrop-blur-md">
        <Play className="size-4 fill-white translate-x-0.5" />
      </span>
    </button>
  );
}

/** Application-themed center-play overlay with the previous gold styling. */
export function CenterPlayButton({ playerState, onPlaybackToggle }: CenterPlayButtonProps) {
  const shouldShowPlay = playerState === "paused" || playerState === "error";
  if (!shouldShowPlay) return null;
  return (
    <button
      type="button"
      onClick={(event) => onPlaybackToggle(event)}
      className="absolute inset-0 grid place-items-center bg-black/20 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
      aria-label="Resume live broadcast"
    >
      <span className="grid size-8 place-items-center rounded-full border border-white/55 bg-black/65 text-primary shadow-[0_0_36px_rgba(251,191,36,0.25)] backdrop-blur-md">
        <Play className="size-4 fill-primary translate-x-0.5" />
      </span>
    </button>
  );
}