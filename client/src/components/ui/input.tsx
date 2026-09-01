import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    // h-9 to match icon buttons and default buttons.
    return (
      <input
        type={type}
        className={cn(
          "rounded-full flex h-14 w-full border border-white/10 bg-transparent px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium text-white file:text-foreground placeholder:text-white/75 focus-visible:border-primary/75 focus-visible:outline-none focus-visible:ring-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
