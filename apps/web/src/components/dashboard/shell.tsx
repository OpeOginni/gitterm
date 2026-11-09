import { cn } from "@/lib/utils";
import type React from "react";
import { FeedbackForm } from "./feedback";

interface DashboardShellProps {
  children: React.ReactNode;
  className?: string;
}

export function DashboardShell({ children, className }: DashboardShellProps) {
  return (
    <>
      <div className={cn("flex-1 px-4 py-6 sm:p-6 md:p-8 lg:p-10", className)}>
        <div className="mx-auto max-w-7xl space-y-8">{children}</div>
      </div>
      <div className="fixed bottom-6 right-6 z-50">
        <FeedbackForm />
      </div>
    </>
  );
}

export function DashboardHeader({
  heading,
  text,
  icon,
  children,
  className,
}: {
  heading: string;
  text?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          {icon}
          <h1 className="text-[26px] font-display font-semibold leading-tight tracking-[-0.025em] text-balance text-fg md:text-[30px]">
            {heading}
          </h1>
        </div>
        {text ? <p className="max-w-2xl text-[15px] leading-relaxed text-fg-3">{text}</p> : null}
      </div>
      {children}
    </div>
  );
}
