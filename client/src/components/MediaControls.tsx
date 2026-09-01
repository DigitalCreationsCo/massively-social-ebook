import { Pause, Play, RotateCw, Volume2, VolumeX } from "lucide-react";
import { type MouseEvent } from "react";
import { cn } from "@/lib/utils";

export type PlayerState = "idle" | "loading" | "playing" | "paused" | "reconnecting" | "error";

interface MediaControlsProps {
  playerState: PlayerState;
  isMuted: boolean;
  isLive: boolean;
  isBusy: boolean;
  onPlaybackToggle: (event?: MouseEvent<HTMLButtonElement>) => void;
  onToggleMute: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}

export function MediaControls({
  playerState,
  isMuted,
  isLive,
  isBusy,
  onPlaybackToggle,
  onToggleMute,
  className,
}: MediaControlsProps) {
  const shouldShowPlay = playerState === "paused" || playerState === "error";

  return (
    <div className={cn("absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-4 sm:p-5", className)}>
      <div className="min-w-0">
        <p className="font-mono text-[10px] animate-pulse uppercase tracking-[0.23em]">Live</p>
        <p className="mt-1 text-xs text-white/55">
          {isBusy ? "Reacquiring the signal" : playerState === "error" ? "Signal could not be restored" : isMuted ? "Tap audio to join in" : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onToggleMute}
          className="grid size-10 place-items-center rounded-full border border-white/15 bg-black/45 text-white/85 backdrop-blur-md transition hover:border-white/60 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={isMuted ? "Turn sound on" : "Mute broadcast"}
        >
          {isMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
        <button
          type="button"
          onClick={(event) => onPlaybackToggle(event)}
          disabled={isBusy}
          className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_0_24px_rgba(251,191,36,0.32)] transition hover:scale-105 disabled:cursor-wait disabled:opacity-65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          aria-label={playerState === "playing" ? "Pause broadcast" : "Play broadcast"}
        >
          {isBusy ? <RotateCw className="size-4 animate-spin" /> : playerState === "playing" ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
        </button>
      </div>
    </div>
  );
}

interface CenterPlayButtonProps {
  playerState: PlayerState;
  isBusy: boolean;
  onPlaybackToggle: (event?: MouseEvent<HTMLButtonElement>) => void;
}

export function CenterPlayButton({ playerState, isBusy, onPlaybackToggle }: CenterPlayButtonProps) {
  const shouldShowPlay = playerState === "paused" || playerState === "error";

  if (!shouldShowPlay) return null;

  return (
    <button
      type="button"
      onClick={(event) => onPlaybackToggle(event)}
      className="absolute inset-0 grid place-items-center bg-black/20 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
      aria-label="Resume live broadcast"
    >
      <span className="grid size-16 place-items-center rounded-full border border-white/55 bg-black/65 text-primary shadow-[0_0_36px_rgba(251,191,36,0.25)] backdrop-blur-md">
        <Play className="size-6 translate-x-0.5" />
      </span>
    </button>
  );
}