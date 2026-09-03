"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { Check, ChevronDown, ChevronRight, Star } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { getModelProviderLogo } from "./types";

export interface ProviderCredential {
  id: string;
  authType: string;
  label: string | null;
  isDefault: boolean;
}

export interface ProviderGroup {
  /** Logical provider key, e.g. "anthropic", "openai". Doubles as the logo lookup. */
  key: string;
  name: string;
  credentials: ProviderCredential[];
}

interface ModelProviderPickerProps {
  groups: ProviderGroup[];
  /** group.key → selected credential id, or null when the provider is excluded */
  selections: Record<string, string | null>;
  onChange: (key: string, credentialId: string | null) => void;
}

function credentialLabel(credential: ProviderCredential | undefined) {
  if (!credential) return "";
  return credential.label || (credential.authType === "oauth" ? "OAuth" : "API key");
}

/**
 * Default marker. Same filled star the settings credential list uses, so the
 * two surfaces read as the same concept.
 */
function DefaultStar({ className }: { className?: string }) {
  return (
    <>
      <Star className={cn("shrink-0 fill-current opacity-80", className)} aria-hidden />
      <span className="sr-only">Default</span>
    </>
  );
}

/** Above this many credentials the mobile chips scroll sideways instead of wrapping. */
const CHIP_WRAP_LIMIT = 5;

/** Provider mark with a lettered fallback when no SVG ships for that key. */
function ProviderLogo({
  providerKey,
  name,
  size = 28,
  className,
}: {
  providerKey: string;
  name: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = getModelProviderLogo(providerKey);
  const markSize = Math.round(size * 0.6);

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-2",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {failed || !src ? (
        <span className="font-mono text-[11px] font-semibold uppercase text-fg-2">
          {name.slice(0, 1)}
        </span>
      ) : (
        <Image
          src={src}
          alt=""
          width={markSize}
          height={markSize}
          className="object-contain"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

/**
 * Deck of the included providers, shown on the closed trigger.
 *
 * Cards sit side by side on one baseline, overlapping like a fanned hand held
 * flat. At rest they overlap heavily so the deck stays compact; on hover they
 * slide apart and tilt a touch so each mark is mostly visible. The slot itself
 * widens with the fan (animated), so the deck pushes the label over instead of
 * spilling across it. Pure CSS: rest and fan values live in custom properties
 * and `group-hover` swaps between them.
 */
const CARD = 28;
/** Horizontal step between cards when squared up (heavy overlap). */
const REST_STEP = 11;
/** Horizontal step between cards when fanned (marks mostly visible). */
const FAN_STEP = 23;

function LogoDeck({ groups }: { groups: ProviderGroup[] }) {
  const shown = groups.slice(0, 4);
  const extra = groups.length - shown.length;
  const cards: Array<{ key: string; node: ReactNode }> = shown.map((group) => ({
    key: group.key,
    node: (
      <ProviderLogo
        providerKey={group.key}
        name={group.name}
        size={CARD}
        className="border-line-2 shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
      />
    ),
  }));
  if (extra > 0) {
    cards.push({
      key: "extra",
      node: (
        <span
          className="inline-flex items-center justify-center rounded-lg border border-line-2 bg-surface-2 font-mono text-[10px] text-fg-3 shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
          style={{ width: CARD, height: CARD }}
        >
          +{extra}
        </span>
      ),
    });
  }

  const n = cards.length;
  if (n === 0) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-lg border border-dashed border-line-2 font-mono text-[10px] text-fg-4"
        style={{ width: CARD, height: CARD }}
      >
        0
      </span>
    );
  }
  if (n === 1) return <>{cards[0].node}</>;

  const mid = (n - 1) / 2;
  const slotStyle = {
    height: CARD,
    "--rest-w": `${CARD + (n - 1) * REST_STEP}px`,
    "--fan-w": `${CARD + (n - 1) * FAN_STEP}px`,
  } as CSSProperties;

  return (
    <span
      style={slotStyle}
      className="relative block shrink-0 [width:var(--rest-w)] transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:[width:var(--fan-w)] motion-reduce:transition-none"
    >
      {cards.map((card, i) => {
        const offset = i - mid;
        const style = {
          zIndex: n - i,
          transformOrigin: "50% 120%",
          "--rest": `translateX(${i * REST_STEP}px)`,
          "--fan": `translateX(${i * FAN_STEP}px) rotate(${offset * 4}deg)`,
        } as CSSProperties;
        return (
          <span
            key={card.key}
            style={style}
            className="absolute left-0 top-0 [transform:var(--rest)] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:[transform:var(--fan)] motion-reduce:transition-none"
          >
            {card.node}
          </span>
        );
      })}
    </span>
  );
}

export function ModelProviderPicker({ groups, selections, onChange }: ModelProviderPickerProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const included = groups.filter((group) => !!selections[group.key]);
  const summary =
    included.length === groups.length
      ? `All ${groups.length} included`
      : `${included.length} of ${groups.length} included`;

  function toggle(group: ProviderGroup) {
    const current = selections[group.key] ?? null;
    onChange(
      group.key,
      current
        ? null
        : (group.credentials.find((credential) => credential.isDefault)?.id ??
            group.credentials[0]?.id ??
            null),
    );
  }

  const trigger = (
    <button
      type="button"
      className="group flex w-full items-center gap-3 rounded-xl border border-line bg-fill px-3 py-2.5 text-left transition-colors hover:border-line-2 hover:bg-fill-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <LogoDeck groups={included} />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-fg">Model providers</span>
        <span className="block truncate text-[11px] text-fg-3">
          {included.length === 0
            ? "None included"
            : included.length <= 3
              ? included.map((group) => group.name).join(" · ")
              : summary}
        </span>
      </span>
      <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-fg-4 sm:block">
        {summary}
      </span>
      {isMobile ? (
        <ChevronRight className="h-4 w-4 shrink-0 text-fg-4" />
      ) : (
        <ChevronDown className="h-4 w-4 shrink-0 text-fg-4" />
      )}
    </button>
  );

  /* ── Phone: bottom sheet with tall touch rows and chip-style credential choice ── */
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="max-h-[85dvh] gap-0 rounded-t-2xl border-line bg-surface-2 p-0"
        >
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line-2" aria-hidden />
          <SheetHeader className="px-5 pb-3 pt-4">
            <SheetTitle className="text-base font-semibold text-fg">Model providers</SheetTitle>
            <SheetDescription className="text-[13px] text-fg-3">
              Pick which of your saved credentials this workspace can use.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-3 pb-2">
            <ul className="divide-y divide-line rounded-xl border border-line bg-background">
              {groups.map((group) => {
                const selectedId = selections[group.key] ?? null;
                const isIncluded = !!selectedId;
                const multi = group.credentials.length > 1;
                return (
                  <li key={group.key}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isIncluded}
                      onClick={() => toggle(group)}
                      className="flex min-h-14 w-full items-center gap-3.5 px-3.5 py-3 text-left"
                    >
                      <ProviderLogo providerKey={group.key} name={group.name} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-medium text-fg">{group.name}</span>
                        <span className="block text-xs text-fg-3">
                          {multi
                            ? `${group.credentials.length} credentials`
                            : credentialLabel(group.credentials[0])}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "inline-flex h-6 w-6 items-center justify-center rounded-full border transition-colors",
                          isIncluded
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-line-2 text-transparent",
                        )}
                      >
                        <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                      </span>
                    </button>

                    {multi && isIncluded && (
                      <div
                        className={cn(
                          "flex gap-2 px-3.5 pb-3.5 pl-[62px]",
                          group.credentials.length > CHIP_WRAP_LIMIT
                            ? "overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                            : "flex-wrap",
                        )}
                      >
                        {group.credentials.map((credential) => {
                          const active = credential.id === selectedId;
                          return (
                            <button
                              key={credential.id}
                              type="button"
                              title={credentialLabel(credential)}
                              onClick={() => onChange(group.key, credential.id)}
                              className={cn(
                                "inline-flex max-w-[180px] shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[11px] transition-colors",
                                active
                                  ? "border-primary/50 bg-primary/15 text-primary"
                                  : "border-line bg-fill text-fg-3",
                              )}
                            >
                              {credential.isDefault && <DefaultStar className="h-2.5 w-2.5" />}
                              <span className="truncate">{credentialLabel(credential)}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Link
              href={"/dashboard/settings/providers#model-credentials" as Route}
              className="text-[13px] text-fg-3 underline decoration-line-2 underline-offset-4 hover:text-fg"
            >
              Manage credentials
            </Link>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-10 rounded-lg bg-primary px-5 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-primary-foreground"
            >
              Done
            </button>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  /* ── Desktop: compact popover ── */
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[400px] max-w-[calc(100vw-3rem)] border-line bg-surface-2 p-0"
      >
        <div className="px-4 pb-2 pt-3.5">
          <p className="text-[13px] font-medium text-fg">Model providers for this workspace</p>
          <p className="mt-0.5 text-[11.5px] text-fg-3">
            Defaults are selected automatically. Untick a provider to leave it out.
          </p>
        </div>

        <ul className="max-h-[320px] overflow-y-auto px-1.5 pb-1">
          {groups.map((group) => {
            const selectedId = selections[group.key] ?? null;
            const isIncluded = !!selectedId;
            const multi = group.credentials.length > 1;
            return (
              <li key={group.key}>
                <div
                  role="checkbox"
                  tabIndex={0}
                  aria-checked={isIncluded}
                  onClick={() => toggle(group)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggle(group);
                    }
                  }}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 outline-none transition-colors hover:bg-fill focus-visible:bg-fill-2",
                    !isIncluded && "opacity-70",
                  )}
                >
                  <Checkbox checked={isIncluded} className="pointer-events-none" />
                  <ProviderLogo providerKey={group.key} name={group.name} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">{group.name}</span>
                    {!multi && (
                      <span className="block text-[11px] text-fg-4">
                        {credentialLabel(group.credentials[0])}
                      </span>
                    )}
                  </span>

                  {multi && isIncluded ? (
                    <Select value={selectedId} onValueChange={(id) => onChange(group.key, id)}>
                      <SelectTrigger
                        onClick={(event) => event.stopPropagation()}
                        className="h-8 w-[150px] text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {group.credentials.map((credential) => (
                          <SelectItem key={credential.id} value={credential.id}>
                            {credential.isDefault && (
                              <DefaultStar className="size-3 text-primary" />
                            )}
                            <span className="truncate">{credentialLabel(credential)}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : multi ? (
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-4">
                      {group.credentials.length} keys
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between px-4 pb-3 pt-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-4">
            {summary}
          </span>
          <Link
            href={"/dashboard/settings/providers#model-credentials" as Route}
            className="text-[11.5px] text-fg-3 transition-colors hover:text-fg"
          >
            Manage credentials
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
