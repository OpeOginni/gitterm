"use client";

import { useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Platform } from "./config";

export type BotBehavior = {
  /** Channel ids it answers in; empty answers in every channel it's in. */
  channels: string[];
  /** User ids allowed to use it; empty allows everyone in the channel. */
  allowedUsers: string[];
  allowGuests: boolean;
  instructions: string;
  setup: string;
};

const labelClass = "font-mono text-[11px] uppercase tracking-[0.18em] text-fg-4";

/** Real choices as tiles with a radio dot, like Platform and Compute. */
function OptionTiles<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; title: string; description: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2" role="radiogroup">
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors",
              selected
                ? "border-primary/60 bg-fill"
                : "border-line hover:border-fg-4 hover:bg-fill",
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                selected ? "border-primary" : "border-fg-4",
              )}
            >
              {selected ? <span className="size-2 rounded-full bg-primary" /> : null}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-fg">{option.title}</span>
              <span className="block text-[13px] text-fg-3">{option.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** What a platform's ids look like, so a typo is caught here rather than when nobody can use the bot. */
function idCheck(platform: Platform | null, kind: "channel" | "user") {
  if (platform === "discord") {
    return (id: string) =>
      /^\d{17,20}$/.test(id) ? null : `${id} isn't a Discord ID; those are long numbers.`;
  }
  if (platform === "slack") {
    const pattern = kind === "channel" ? /^[CG][A-Z0-9]{8,}$/ : /^[UW][A-Z0-9]{8,}$/;
    const example = kind === "channel" ? "C07Q2JH8L3M" : "U07Q2JH8L3M";
    return (id: string) =>
      pattern.test(id) ? null : `${id} doesn't look like a Slack ${kind} ID, e.g. ${example}.`;
  }
  return () => null;
}

/**
 * One field holding ids as chips, like an email To field: type or paste and press Enter (a paste
 * adds at once), Backspace on an empty field removes the last one.
 */
function IdList({
  ids,
  onChange,
  placeholder,
  check,
}: {
  ids: string[];
  onChange: (ids: string[]) => void;
  placeholder: string;
  check: (id: string) => string | null;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const add = (text: string) => {
    const parts = text
      .split(/[\s,]+/)
      .map((id) => id.trim())
      .filter(Boolean);
    const bad = parts.filter((id) => check(id));
    const good = parts.filter((id) => !bad.includes(id) && !ids.includes(id));
    if (good.length) onChange([...ids, ...new Set(good)]);
    setError(bad[0] ? check(bad[0]) : null);
    // A rejected id stays in the field to fix.
    setDraft(bad.join(" "));
  };

  return (
    <div className="space-y-1.5">
      <div
        onClick={() => inputRef.current?.focus()}
        className={cn(
          "flex min-h-10 w-full cursor-text flex-wrap items-center gap-1.5 rounded-lg bg-input/70 px-2 py-1.5 transition-shadow focus-within:ring-2 focus-within:ring-ring/40",
          error && "ring-1 ring-amber-400/40",
        )}
      >
        {ids.map((id) => (
          <span
            key={id}
            className="flex max-w-full items-center gap-1 rounded-md bg-fill-2 py-0.5 pr-0.5 pl-2 font-mono text-xs text-fg"
          >
            <span className="truncate">{id}</span>
            <button
              type="button"
              aria-label={`Remove ${id}`}
              onClick={(event) => {
                event.stopPropagation();
                onChange(ids.filter((entry) => entry !== id));
              }}
              className="flex size-5 shrink-0 items-center justify-center rounded text-fg-4 hover:bg-fill hover:text-fg"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add(draft);
            } else if (event.key === "Backspace" && !draft && ids.length) {
              onChange(ids.slice(0, -1));
            }
          }}
          onPaste={(event) => {
            event.preventDefault();
            add(`${draft} ${event.clipboardData.getData("text")}`);
          }}
          onBlur={() => draft && add(draft)}
          placeholder={ids.length ? "" : placeholder}
          className="h-7 min-w-36 flex-1 bg-transparent px-1.5 font-mono text-[13px] text-fg outline-none placeholder:font-sans placeholder:text-fg-4"
        />
      </div>
      {error ? <p className="text-xs text-amber-300">{error}</p> : null}
    </div>
  );
}

/** Where the bot answers, who may use it, and what it should know. All optional. */
export function BehaviorStepBody({
  platform,
  knownChannels,
  behavior,
  onChange,
}: {
  platform: Platform | null;
  /** Channels the running bot reported; empty until it has started once. */
  knownChannels: Array<{ id: string; name: string }>;
  behavior: BotBehavior;
  onChange: (patch: Partial<BotBehavior>) => void;
}) {
  const [someChannels, setSomeChannels] = useState(behavior.channels.length > 0);
  const [somePeople, setSomePeople] = useState(behavior.allowedUsers.length > 0);
  const channelName = (id: string) => knownChannels.find((channel) => channel.id === id)?.name;
  const toggleChannel = (id: string) =>
    onChange({
      channels: behavior.channels.includes(id)
        ? behavior.channels.filter((entry) => entry !== id)
        : [...behavior.channels, id],
    });
  const unknownChannels = behavior.channels.filter((id) => !channelName(id));

  return (
    <div className="divide-y divide-line">
      <section className="space-y-3 pb-5">
        <p className={labelClass}>Where it answers</p>
        <OptionTiles
          value={someChannels ? "some" : "every"}
          options={[
            {
              value: "every",
              title: "Every channel it's in",
              description:
                platform === "slack"
                  ? "Wherever it's invited, and in DMs."
                  : "Wherever it's been added.",
            },
            { value: "some", title: "Only picked channels", description: "Choose them below." },
          ]}
          onChange={(value) => {
            setSomeChannels(value === "some");
            if (value === "every") onChange({ channels: [] });
          }}
        />
        {someChannels ? (
          <div className="space-y-2.5 pt-1">
            {knownChannels.length ? (
              <div className="flex flex-wrap gap-2">
                {knownChannels.map((channel) => {
                  const selected = behavior.channels.includes(channel.id);
                  return (
                    <button
                      key={channel.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleChannel(channel.id)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] transition-colors",
                        selected
                          ? "border-primary/60 bg-fill text-fg"
                          : "border-line text-fg-3 hover:border-fg-4 hover:text-fg-2",
                      )}
                    >
                      {selected ? <Check className="size-3.5 text-primary" /> : null}
                      {channel.name}
                    </button>
                  );
                })}
              </div>
            ) : null}
            {/* Pasted ids; picked channels stay as chips above. */}
            <IdList
              ids={unknownChannels}
              onChange={(ids) =>
                onChange({
                  channels: [...behavior.channels.filter((id) => channelName(id)), ...ids],
                })
              }
              placeholder="Paste channel IDs"
              check={idCheck(platform, "channel")}
            />
            <p className="text-xs text-fg-4">
              {knownChannels.length
                ? ""
                : "Its channels show up here to click once it has started. "}
              {platform === "discord"
                ? "Right-click a channel → Copy Channel ID (Developer Mode)."
                : "A channel's ID is at the bottom of its details (C0…)."}
            </p>
          </div>
        ) : null}
      </section>

      <section className="space-y-3 py-5">
        <p className={labelClass}>Who can use it</p>
        <OptionTiles
          value={somePeople ? "some" : "everyone"}
          options={[
            {
              value: "everyone",
              title: "Everyone",
              description: "Anyone where it answers.",
            },
            { value: "some", title: "Only listed people", description: "Add them below." },
          ]}
          onChange={(value) => {
            setSomePeople(value === "some");
            if (value === "everyone") onChange({ allowedUsers: [] });
          }}
        />
        {somePeople ? (
          <div className="space-y-2.5 pt-1">
            <IdList
              ids={behavior.allowedUsers}
              onChange={(allowedUsers) => onChange({ allowedUsers })}
              placeholder={platform === "discord" ? "Paste user IDs" : "Paste member IDs"}
              check={idCheck(platform, "user")}
            />
            <p className="text-xs text-fg-4">
              {platform === "discord"
                ? "Right-click a person → Copy User ID (Developer Mode)."
                : "A person's profile → ⋯ → Copy member ID."}
            </p>
          </div>
        ) : null}
        {platform !== "discord" ? (
          <label className="flex cursor-pointer items-center justify-between gap-4 pt-2">
            <span>
              <span className="block text-sm text-fg">Let guests use it</span>
              <span className="block text-[13px] text-fg-3">
                Slack guests, and people from other organisations in shared channels.
              </span>
            </span>
            <Switch
              checked={behavior.allowGuests}
              onCheckedChange={(allowGuests) => onChange({ allowGuests })}
            />
          </label>
        ) : null}
      </section>

      <section className="space-y-2 py-5">
        <p className={labelClass}>Instructions</p>
        <Textarea
          value={behavior.instructions}
          onChange={(event) => onChange({ instructions: event.target.value })}
          placeholder="What the agent should know, e.g. Run pnpm test before opening a pull request."
          rows={4}
          className="text-sm"
        />
      </section>

      <section className="space-y-2 pt-5">
        <p className={labelClass}>Setup command</p>
        <Input
          value={behavior.setup}
          onChange={(event) => onChange({ setup: event.target.value })}
          placeholder="pnpm install"
          className="font-mono text-sm"
        />
        <p className="text-xs text-fg-4">
          Runs in the checkout before the agent starts in a new sandbox.
        </p>
      </section>
    </div>
  );
}
