import type { ReactNode } from "react";
import Image from "next/image";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { IntegrationMeta } from "./meta";

export function IntegrationLogo({
  meta,
  size = "md",
  className,
}: {
  meta: IntegrationMeta;
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl border border-border",
        meta.accent,
        size === "lg" ? "h-14 w-14" : "h-11 w-11",
        className,
      )}
    >
      <Image
        src={meta.logo}
        alt=""
        width={size === "lg" ? 28 : 20}
        height={size === "lg" ? 28 : 20}
        className={cn("object-contain", size === "lg" ? "h-7 w-7" : "h-5 w-5")}
      />
    </div>
  );
}

export function StatusBadge({
  status,
}: {
  status: "enabled" | "disabled" | "unconfigured" | "planned";
}) {
  const styles = {
    enabled: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
    disabled: "border-foreground/[0.08] bg-foreground/[0.04] text-muted-foreground",
    unconfigured: "border-amber-500/20 bg-amber-500/10 text-amber-400",
    planned: "border-foreground/[0.08] bg-foreground/[0.04] text-muted-foreground",
  } as const;
  const labels = {
    enabled: "Enabled",
    disabled: "Disabled",
    unconfigured: "Not configured",
    planned: "Coming soon",
  } as const;
  return (
    <Badge variant="outline" className={cn("text-[10px]", styles[status])}>
      {labels[status]}
    </Badge>
  );
}

export function SectionCard({
  icon: Icon,
  title,
  description,
  action,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-border bg-card p-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Icon className="size-4 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground/90">{title}</p>
          </div>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      {children ? <div className="mt-5">{children}</div> : null}
    </section>
  );
}
