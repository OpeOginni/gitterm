"use client";

import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronRight } from "lucide-react";
import { trpc } from "@/utils/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { LineCell, LineGrid, SectionHeading, StatusDot } from "../kit";
import { EXPIRY_TEXT, answersIn, botStatus, platformName, repoParts, tokenExpiry } from "./status";

/** Bot, repository, model, token, status, chevron. */
const columns =
  "lg:grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.95fr)_minmax(0,0.9fr)_1rem] lg:items-center lg:gap-6";

export function BotList() {
  const { data: bots, isLoading } = useQuery(trpc.bots.list.queryOptions());

  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-xl border border-line">
        <TableHeader />
        <ul className="divide-y divide-line">
          {[0, 1, 2].map((row) => (
            <BotRowSkeleton key={row} />
          ))}
        </ul>
      </div>
    );
  }

  if (!bots?.length) return <BotsEmpty />;

  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <TableHeader />
      <ul className="divide-y divide-line">
        {bots.map((bot) => {
          const status = botStatus(bot.token);
          const expiry = tokenExpiry(bot.token);
          const repo = repoParts(bot.repo);
          return (
            <li key={bot.id}>
              <Link
                href={`/dashboard/bots/${bot.id}` as Route}
                className={cn(
                  columns,
                  "group flex items-start gap-3.5 px-4 py-4 transition-colors hover:bg-fill sm:px-5",
                )}
              >
                {/* Bot */}
                <span className="flex min-w-0 flex-1 items-start gap-3.5 lg:items-center">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-fill">
                    <Image src={`/${bot.platform}.svg`} alt="" width={18} height={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-3">
                      <span className="truncate text-[14px] font-medium text-fg">{bot.name}</span>
                      <StatusDot tone={status.tone} pulse={status.pulse} className="lg:hidden">
                        {status.label}
                      </StatusDot>
                    </span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-fg-3">
                      {platformName(bot.platform)} · {answersIn(bot.channels).toLowerCase()}
                    </span>
                    {/* Phones: the other columns as two quiet lines. */}
                    <span className="mt-1.5 block truncate font-mono text-[12.5px] text-fg-3 lg:hidden">
                      {repo.name}
                      <span className="text-fg-4"> · {bot.model.split("/").pop()}</span>
                    </span>
                    <span className="mt-1 block truncate text-[12.5px] text-fg-4 lg:hidden">
                      {status.detail}
                      <span className={cn(expiry.tone !== "muted" && EXPIRY_TEXT[expiry.tone])}>
                        {" "}
                        · {expiry.text}
                      </span>
                    </span>
                  </span>
                </span>

                {/* Repository */}
                <span className="hidden min-w-0 lg:block">
                  <span className="block truncate font-mono text-[13px] text-fg-2">
                    {repo.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-fg-4">
                    {repo.branch ?? "Default branch"}
                  </span>
                </span>

                {/* Model */}
                <span className="hidden min-w-0 lg:block">
                  <span className="block truncate font-mono text-[13px] text-fg-2">
                    {bot.model.split("/").slice(1).join("/")}
                  </span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-fg-4">
                    {bot.model.split("/")[0]}
                  </span>
                </span>

                {/* Token */}
                <span className="hidden min-w-0 lg:block">
                  <span className="block truncate font-mono text-[13px] text-fg-3">
                    {bot.token && !bot.token.revoked ? `${bot.token.prefix}…` : "None"}
                  </span>
                  <span
                    className={cn("mt-0.5 block truncate text-[12.5px]", EXPIRY_TEXT[expiry.tone])}
                  >
                    {expiry.text}
                  </span>
                </span>

                {/* Status */}
                <span className="hidden min-w-0 lg:block">
                  <StatusDot tone={status.tone} pulse={status.pulse}>
                    {status.label}
                  </StatusDot>
                  <span className="mt-0.5 block truncate text-[12.5px] text-fg-4">
                    {status.detail}
                  </span>
                </span>

                <ChevronRight className="mt-2.5 hidden size-4 shrink-0 text-fg-4 transition-colors group-hover:text-fg lg:mt-0 lg:block" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TableHeader() {
  return (
    <div
      className={cn(
        columns,
        "hidden border-b border-line px-5 py-2.5 text-[12.5px] text-fg-4 lg:grid",
      )}
    >
      <span>Bot</span>
      <span>Repository</span>
      <span>Model</span>
      <span>Token</span>
      <span>Status</span>
      <span />
    </div>
  );
}

/** Two short lines, the height of a cell's value and its detail. */
function CellSkeleton({ width = "w-24" }: { width?: string }) {
  return (
    <span className="block min-w-0">
      <span className="flex h-5 items-center">
        <Skeleton className={cn("h-3.5 max-w-full bg-fill-2", width)} />
      </span>
      <span className="mt-0.5 flex h-[18px] items-center">
        <Skeleton className="h-3 w-16 max-w-full bg-fill-2" />
      </span>
    </span>
  );
}

/** A bot row's shape: the bot, then repository, model, token and status on wide screens. */
function BotRowSkeleton() {
  return (
    <li className={cn(columns, "flex items-start gap-3.5 px-4 py-4 sm:px-5")}>
      <span className="flex min-w-0 flex-1 items-center gap-3.5">
        <Skeleton className="size-9 shrink-0 rounded-lg bg-fill-2" />
        <CellSkeleton width="w-28" />
      </span>
      <span className="hidden lg:block">
        <CellSkeleton />
      </span>
      <span className="hidden lg:block">
        <CellSkeleton width="w-28" />
      </span>
      <span className="hidden lg:block">
        <CellSkeleton width="w-20" />
      </span>
      <span className="hidden lg:block">
        <CellSkeleton width="w-16" />
      </span>
      <span className="hidden lg:block" />
    </li>
  );
}

const PLATFORMS = [
  {
    value: "slack",
    title: "Slack",
    text: "Mention it in a channel or a DM. It answers in the thread.",
  },
  {
    value: "discord",
    title: "Discord",
    text: "Mention it in a server channel. It answers in a thread.",
  },
] as const;

const HOW = [
  {
    title: "Pick a model and a repository",
    text: "Settings are saved here. The bot loads them each time it starts.",
  },
  {
    title: "Create the chat app",
    text: "Slack from a ready manifest, Discord from its developer portal.",
  },
  {
    title: "Run it anywhere",
    text: "One Docker image, with a .env that holds only secrets.",
  },
];

/** No bots yet: what a bot is, and a way into each platform's setup. */
function BotsEmpty() {
  return (
    <div className="space-y-12">
      <LineGrid className="md:grid-cols-2">
        {PLATFORMS.map((platform) => (
          <LineCell key={platform.value} className="gap-3 p-6">
            <div className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-fill">
                <Image src={`/${platform.value}.svg`} alt="" width={18} height={18} />
              </span>
              <h2 className="font-display text-[20px] font-semibold tracking-[-0.02em] text-fg">
                {platform.title}
              </h2>
            </div>
            <p className="max-w-sm text-[13.5px] leading-relaxed text-fg-3">{platform.text}</p>
            <Link
              href={`/dashboard/bots/new?platform=${platform.value}` as Route}
              className="group mt-2 inline-flex w-fit items-center gap-1.5 text-[13.5px] font-medium text-fg-2 transition-colors hover:text-fg"
            >
              Set up a {platform.title} bot
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </LineCell>
        ))}
      </LineGrid>

      <section className="space-y-4">
        <SectionHeading
          title="How it works"
          description="The agent works in a cloud sandbox with your repository checked out."
        />
        <LineGrid className="md:grid-cols-3">
          {HOW.map((step, index) => (
            <LineCell key={step.title} className="gap-1.5">
              <span className="font-mono text-[12.5px] text-fg-4">{index + 1}</span>
              <span className="text-[14px] font-medium text-fg">{step.title}</span>
              <p className="text-[13px] leading-relaxed text-fg-3">{step.text}</p>
            </LineCell>
          ))}
        </LineGrid>
      </section>
    </div>
  );
}
