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
      <div className={cn("flex-1 p-6 md:p-8 lg:p-10", className)}>
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
      className={cn(
        "flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-3">
          {icon}
          <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl text-balance">
            {heading}
          </h1>
        </div>
        {text ? <p className="text-sm text-fg-4 md:text-base">{text}</p> : null}
      </div>
      {children}
    </div>
  );
}
