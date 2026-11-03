import Image from "next/image";
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
        "flex shrink-0 items-center justify-center rounded-xl bg-fill",
        size === "lg" ? "h-14 w-14" : "h-10 w-10",
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

/** Quiet status chip: a coloured dot and a word. */
export function StatusChip({ tone, label }: { tone: "ok" | "warn" | "muted"; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-fill-2 px-2 py-0.5 text-[12.5px] text-fg-3">
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          tone === "ok" ? "bg-[#6bd586]" : tone === "warn" ? "bg-[#fb923c]" : "bg-fg-4",
        )}
      />
      {label}
    </span>
  );
}

export function StatusBadge({
  status,
}: {
  status: "enabled" | "disabled" | "unconfigured" | "planned";
}) {
  const tones = {
    enabled: "ok",
    disabled: "muted",
    unconfigured: "warn",
    planned: "muted",
  } as const;
  const labels = {
    enabled: "Enabled",
    disabled: "Disabled",
    unconfigured: "Not configured",
    planned: "Coming soon",
  } as const;
  return <StatusChip tone={tones[status]} label={labels[status]} />;
}
