"use client";

import { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { getModelProviderLogo } from "@/components/dashboard/create-instance/types";

/** Provider mark with a lettered fallback when no SVG ships for that provider. */
export function ProviderLogo({
  name,
  displayName,
  size = 16,
  className,
}: {
  name: string;
  displayName: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = getModelProviderLogo(name);

  if (failed || !src) {
    return (
      <span
        aria-hidden
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-[4px] bg-fill-2 font-mono font-semibold uppercase text-fg-2",
          className,
        )}
        style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.6)) }}
      >
        {displayName.slice(0, 1)}
      </span>
    );
  }

  return (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0 object-contain", className)}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}
