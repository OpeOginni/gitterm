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
  children,
  className,
}: {
  heading: string;
  text?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 border-b border-white/[0.06] pb-6 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl text-balance">
          {heading}
        </h1>
        {text ? (
          <p className="text-sm text-white/40 md:text-base">{text}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}
