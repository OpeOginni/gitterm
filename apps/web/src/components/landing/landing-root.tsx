"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { startLanding } from "./engine";
import "./landing.css";

/** The landing page root (`.lp`): scopes the demo styles and runs the demo engine. */
export function LandingRoot({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    return startLanding(ref.current);
  }, []);
  return (
    <div ref={ref} className={cn("lp", className)}>
      {children}
    </div>
  );
}
