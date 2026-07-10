import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * FormCard
 *
 * Editorial, terminal-inspired container for grouped form rows. Use for any
 * meaningful "form unit" in the app (hero launch, auth, enterprise contact,
 * settings panels, etc).
 *
 * Layout primitives:
 *   - <FormCard>            wrapper with one outer border + radius
 *   - <FormCardHeader>      optional eyebrow + status pill row
 *   - <FormCardBody>        the actual fields (single inset surface)
 *   - <FormCardFooter>      optional meta row (hairline divider only)
 *
 * Style rules baked in (don't fight them with overrides unless you must):
 *   - one border (the outer)
 *   - one radius (rounded-2xl)
 *   - inputs/buttons inside use the shared `bg-input` inset surface
 *   - header/footer divide via hairline, not nested borders
 */

function FormCard({
  className,
  tone = "default",
  ...props
}: React.ComponentProps<"div"> & {
  /** Visual tone of the outer ring; success switches the border to emerald. */
  tone?: "default" | "success";
}) {
  return (
    <div
      data-slot="form-card"
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-card shadow-[0_30px_120px_-40px_rgba(0,0,0,0.6)]",
        tone === "default" && "border-white/[0.08]",
        tone === "success" && "border-emerald-500/30",
        className,
      )}
      {...props}
    />
  );
}

function FormCardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="form-card-header"
      className={cn(
        "flex items-center justify-between gap-3 px-4 pt-3.5 pb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-white/40",
        className,
      )}
      {...props}
    />
  );
}

function FormCardBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="form-card-body"
      className={cn("px-3.5 pt-2 pb-4 sm:px-4", className)}
      {...props}
    />
  );
}

function FormCardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="form-card-footer"
      className={cn(
        "flex items-center justify-between gap-3 border-t border-white/[0.05] bg-white/[0.015] px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.22em] text-white/35",
        className,
      )}
      {...props}
    />
  );
}

/** Pulsing status pill, e.g. for "ready / running / expired". */
function FormCardStatus({
  className,
  tone = "ready",
  children,
  ...props
}: React.ComponentProps<"span"> & {
  tone?: "ready" | "expired" | "muted";
}) {
  const dotClass =
    tone === "ready"
      ? "animate-pulse bg-emerald-400"
      : tone === "expired"
        ? "bg-red-400/80"
        : "bg-white/40";
  const textClass =
    tone === "ready"
      ? "text-emerald-400/85"
      : tone === "expired"
        ? "text-red-300/80"
        : "text-white/50";

  return (
    <span
      data-slot="form-card-status"
      className={cn(
        "flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em]",
        textClass,
        className,
      )}
      {...props}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dotClass)} />
      {children}
    </span>
  );
}

/**
 * SettingsSection
 *
 * Editorial section card used across the dashboard's Settings tabs (workspace
 * config, account, etc). Has a built-in header strip with:
 *   - mono eyebrow (e.g. `01 / Section`)
 *   - icon + title row
 *   - one-line description
 *   - optional `action` slot on the right (e.g. `Add Credential` button)
 *
 * Use the body wrapper (`SettingsSectionBody`) for consistent padding.
 */

function SettingsSection({
  className,
  eyebrow,
  title,
  description,
  icon: Icon,
  action,
  children,
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
}) {
  return (
    <section
      data-slot="settings-section"
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/[0.08] bg-card shadow-[0_20px_70px_-30px_rgba(0,0,0,0.55)]",
        className,
      )}
      {...props}
    >
      <header className="space-y-2.5 border-b border-white/[0.05] bg-white/[0.02] px-5 py-4">
        {eyebrow && (
          <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
            {eyebrow}
          </span>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {Icon && (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.04]">
                <Icon className="h-4 w-4 text-white/60" />
              </span>
            )}
            <h3 className="text-lg font-semibold tracking-tight text-white">{title}</h3>
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
        {description && (
          <p className="max-w-2xl text-[13px] leading-relaxed text-white/45">{description}</p>
        )}
      </header>
      {children}
    </section>
  );
}

function SettingsSectionBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="settings-section-body" className={cn("p-5", className)} {...props} />;
}

/**
 * Bordered, hairline-divided list container for rows inside a settings card.
 * Use with <SettingsRow> so every section's lists read the same way
 * (tokens, quotas, workspaces, toggles, ...).
 */
function SettingsRowList({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="settings-row-list"
      className={cn(
        "divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.06] bg-input/40",
        className,
      )}
      {...props}
    />
  );
}

function SettingsRow({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="settings-row"
      className={cn(
        "flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-white/[0.015] sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
      {...props}
    />
  );
}

/** Dashed placeholder panel for sections with nothing to show yet. */
function SettingsEmptyState({
  className,
  icon: Icon,
  title,
  description,
  action,
  ...props
}: React.ComponentProps<"div"> & {
  icon?: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      data-slot="settings-empty-state"
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-dashed border-white/[0.08] bg-white/[0.01] px-6 py-10 text-center",
        className,
      )}
      {...props}
    >
      {Icon && (
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.04]">
          <Icon className="h-5 w-5 text-white/30" />
        </span>
      )}
      <div className="space-y-1">
        <p className="text-sm text-white/60">{title}</p>
        {description && (
          <p className="mx-auto max-w-sm text-[12px] leading-relaxed text-white/35">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export {
  FormCard,
  FormCardHeader,
  FormCardBody,
  FormCardFooter,
  FormCardStatus,
  SettingsSection,
  SettingsSectionBody,
  SettingsRowList,
  SettingsRow,
  SettingsEmptyState,
};
