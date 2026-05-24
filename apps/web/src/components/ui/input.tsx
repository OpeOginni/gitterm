import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground bg-input/70 flex h-10 w-full min-w-0 rounded-lg border border-transparent px-3.5 py-1 text-sm transition-[background-color,color,box-shadow,border-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 hover:bg-input md:text-sm",
        "focus-visible:bg-input focus-visible:ring-2 focus-visible:ring-ring/40",
        "aria-invalid:border-destructive/60 aria-invalid:ring-destructive/25 dark:aria-invalid:ring-destructive/35",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
