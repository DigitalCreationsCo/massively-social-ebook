import { Volume, Volume2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SpeakerButtonProps {
  isSpeaking: boolean;
  isPending: boolean;
  hasError: boolean;
  onClick: () => void;
  className?: string;
}

export function SpeakerButton({
  isSpeaking,
  isPending,
  hasError,
  onClick,
  className,
}: SpeakerButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      className={cn(
        "flex items-center justify-center w-9 h-9 rounded-full transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        isSpeaking &&
          "text-primary bg-primary/10 [&_svg]:animate-pulse",
        !isSpeaking &&
          !hasError &&
          "text-muted-foreground hover:text-white/80 active:scale-95",
        hasError && "text-destructive",
        className,
      )}
      aria-label={
        isPending
          ? "Generating speech..."
          : isSpeaking
            ? "Stop reading aloud"
            : "Read aloud"
      }
    >
      {isPending ? (
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
      ) : isSpeaking ? (
        <Volume2 className="w-4 h-4" aria-hidden="true" />
      ) : (
        <Volume className="w-4 h-4" aria-hidden="true" />
      )}
    </button>
  );
}
