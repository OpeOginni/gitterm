import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "bg-input/70 placeholder:text-muted-foreground flex field-sizing-content min-h-20 w-full rounded-lg border border-transparent px-3.5 py-2.5 text-sm leading-relaxed transition-[background-color,color,box-shadow,border-color] outline-none hover:bg-input disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:bg-input focus-visible:ring-2 focus-visible:ring-ring/40",
        "aria-invalid:border-destructive/60 aria-invalid:ring-destructive/25 dark:aria-invalid:ring-destructive/35",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
