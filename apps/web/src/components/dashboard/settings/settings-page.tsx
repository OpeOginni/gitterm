import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { DashboardHeader } from "@/components/dashboard/shell";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/dashboard/kit";
import { cn } from "@/lib/utils";

export function SettingsPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-8">
      <DashboardHeader heading={title} text={description} />
      {children}
    </section>
  );
}

/** A titled part of a settings page, reachable by its anchor (e.g. from the plan badge). */
export function SettingsPart({
  id,
  label,
  description,
  action,
  children,
}: {
  id: string;
  label: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-8 space-y-4">
      <SectionHeading title={label} description={description} action={action} />
      {children}
    </section>
  );
}

/**
 * One settings group: a hairline panel with a title, a short description and its content.
 * Hierarchy comes from spacing and type; the panel has no fill of its own.
 */
export function SettingsGroup({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const hasHeader = title || description || action;
  return (
    <section className={cn("rounded-xl border border-line", className)}>
      {hasHeader ? (
        <header className="px-5 pt-5 sm:px-6">
          {title || action ? (
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              {title ? <h3 className="text-[15px] font-medium text-fg">{title}</h3> : null}
              {action ? (
                <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div>
              ) : null}
            </div>
          ) : null}
          {description ? (
            <p
              className={cn(
                "max-w-2xl text-[13.5px] leading-relaxed text-fg-3",
                (title || action) && "mt-1",
              )}
            >
              {description}
            </p>
          ) : null}
        </header>
      ) : null}
      {children ? (
        <div className={cn("px-5 pb-5 sm:px-6", hasHeader ? "pt-4" : "pt-5", bodyClassName)}>
          {children}
        </div>
      ) : (
        <div className="pb-5" />
      )}
    </section>
  );
}

/** Quiet "nothing here yet" line inside a group. */
export function SettingsEmpty({
  icon,
  title,
  description,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      {icon ? (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-fill text-fg-4 [&_svg]:size-4">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-fg-2">{title}</p>
        {description ? (
          <p className="mt-0.5 text-[13px] leading-relaxed text-fg-3">{description}</p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Save/Cancel bar for settings forms. Sticks to the bottom of the viewport while there are
 * unsaved changes and sits at the bottom right, clear of the feedback button.
 */
export function SettingsSaveBar({
  visible,
  saving,
  disabled,
  onSave,
  onCancel,
  saveLabel = "Save changes",
  note,
}: {
  visible: boolean;
  saving?: boolean;
  disabled?: boolean;
  onSave: () => void;
  onCancel: () => void;
  saveLabel?: string;
  note?: ReactNode;
}) {
  if (!visible) return null;
  return (
    <div className="sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-background/90 px-1 py-4 pr-14 backdrop-blur-md">
      <p className="mr-auto hidden text-[13px] text-fg-3 sm:block">
        {note ?? "You have unsaved changes."}
      </p>
      <Button variant="secondary" onClick={onCancel} disabled={saving}>
        Cancel
      </Button>
      <Button onClick={onSave} disabled={saving || disabled} className="gap-2">
        {saving ? <Loader2 className="size-4 animate-spin" /> : null}
        {saving ? "Saving…" : saveLabel}
      </Button>
    </div>
  );
}

/** Field label used inside settings groups and dialogs: sentence case, readable. */
export const settingsLabel = "text-[13px] font-medium text-fg-2";
