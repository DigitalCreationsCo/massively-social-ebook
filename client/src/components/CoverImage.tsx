import {
  motion,
  useScroll,
  useTransform,
} from "framer-motion";
import { cn } from "@/lib/utils";

export default function CoverImage({
  src,
  className,
  parallaxSpeed = 0,
  parallaxDirection = "up",
}: {
  src?: string;
  className?: string | string[];
  parallaxSpeed?: number;
  parallaxDirection?: "up" | "down";
}) {
  const { scrollY } = useScroll();
  const direction = parallaxDirection === "up" ? -1 : 1;
  const y = useTransform(
    scrollY,
    (latest) => latest * parallaxSpeed * direction,
  );

  if (!src) return null;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 z-0 overflow-hidden",
        className,
      )}
    >
      <motion.img
        src={src}
        alt=""
        className="
                      h-full
                      w-full
                      object-cover
                      opacity-[0.1]
                      scale-105
                      select-none
                  "
        draggable={false}
        style={{ y }}
      />
    </div>
  );
}
