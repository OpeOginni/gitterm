import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";

/**
 * Every public page (landing, docs, pricing, self-host, legal) renders inside this shell:
 * dark theme, the faint dot grid, the site header and footer.
 */
export function SiteShell({
  children,
  className,
  footer = true,
  wide = false,
}: {
  children: ReactNode;
  className?: string;
  footer?: boolean;
  /** 1400px header and footer, for pages whose content uses the wide container (docs). */
  wide?: boolean;
}) {
  return (
    <div
      className={cn("dark landing-grid min-h-screen bg-background text-fg antialiased", className)}
    >
      <SiteHeader wide={wide} />
      <main>{children}</main>
      {footer && <SiteFooter wide={wide} />}
    </div>
  );
}
