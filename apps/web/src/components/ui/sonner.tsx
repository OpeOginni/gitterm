"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, toast, type ToasterProps } from "sonner";

// Errors run longer than confirmations, so they stay 6s instead of sonner's 4s. Sonner has no
// per-type duration, and wrapping here covers every `toast.error` call; a caller's own duration wins.
const showError = toast.error;
toast.error = (message, data) => showError(message, { duration: 6_000, ...data });

/**
 * Toasts are blueprint cells, like the landing page features: a hairline box, a mono status
 * tag on top, and a rail along the bottom in the status color (see `[data-sonner-toast]` in
 * index.css). Callers keep using `toast.success("Title", { description })` as usual.
 */
function Tag({ children }: { children: string }) {
  return (
    <span className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.18em]">
      <span aria-hidden className="h-1.5 w-1.5 bg-current" />
      {children}
    </span>
  );
}

const Toaster = (props: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      closeButton
      style={
        {
          // Sonner's dark theme colors the close button from these, ahead of utility classes.
          "--normal-bg": "transparent",
          "--normal-bg-hover": "var(--fill-2)",
          "--normal-border": "transparent",
          "--normal-border-hover": "transparent",
          "--normal-text": "var(--fg-3)",
        } as React.CSSProperties
      }
      icons={{
        success: <Tag>done</Tag>,
        info: <Tag>info</Tag>,
        warning: <Tag>warning</Tag>,
        error: <Tag>error</Tag>,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-[var(--width)] flex-col gap-2 border border-line bg-card px-4 pt-3.5 pb-4 text-fg shadow-lg",
          icon: "flex",
          content: "flex flex-col gap-1",
          closeButton:
            "absolute top-2.5 right-2.5 flex h-6 w-6 cursor-pointer items-center justify-center transition-colors",
          title: "text-[13.5px] font-medium leading-snug text-fg",
          description: "text-[12.5px] leading-[1.6] text-fg-3",
          actionButton:
            "mt-1 self-start border border-line-2 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-2 hover:bg-fill-2",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
