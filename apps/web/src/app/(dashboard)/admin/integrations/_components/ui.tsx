import Image from "next/image";
import { StatusDot, type Tone } from "@/components/dashboard/kit";
import { cn } from "@/lib/utils";
import type { IntegrationMeta } from "./meta";
import type { IntegrationStatus } from "./use-admin-integrations";

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
        "flex shrink-0 items-center justify-center rounded-lg bg-fill",
        size === "lg" ? "size-12" : "size-9",
        className,
      )}
    >
      <Image
        src={meta.logo}
        alt=""
        width={size === "lg" ? 24 : 18}
        height={size === "lg" ? 24 : 18}
        className={cn("object-contain", size === "lg" ? "size-6" : "size-[18px]")}
      />
    </div>
  );
}

const STATUS: Record<IntegrationStatus, { tone: Tone; label: string }> = {
  enabled: { tone: "ok", label: "On for users" },
  disabled: { tone: "muted", label: "Off" },
  unconfigured: { tone: "warn", label: "Not set up" },
  planned: { tone: "muted", label: "Coming soon" },
};

export function StatusBadge({ status }: { status: IntegrationStatus }) {
  return <StatusDot tone={STATUS[status].tone}>{STATUS[status].label}</StatusDot>;
}
