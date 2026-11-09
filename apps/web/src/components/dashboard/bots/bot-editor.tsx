"use client";

import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { trpc } from "@/utils/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "../kit";
import { BotSetup, BotSetupSkeleton } from "./bot-setup";
import { botStatus, platformName, repoParts } from "./status";

/** Back to the list, above a bot page's title. */
export function BackToBots() {
  return (
    <Link
      href={"/dashboard/bots" as Route}
      className="inline-flex items-center gap-1.5 text-[13px] text-fg-3 transition-colors hover:text-fg"
    >
      <ArrowLeft className="size-3.5" />
      Bots
    </Link>
  );
}

/** A saved bot's page: its settings to edit, and its .env and run commands again. */
export function BotEditor({ id }: { id: string }) {
  const { data: bot, isLoading, error } = useQuery(trpc.bots.get.queryOptions({ id }));
  // The list carries the token's state; usually cached from the page before this one.
  const { data: bots } = useQuery(trpc.bots.list.queryOptions());
  const listed = bots?.find((entry) => entry.id === id);

  if (isLoading) {
    return (
      <>
        <div className="space-y-5">
          <BackToBots />
          <div className="flex items-center gap-4">
            <Skeleton className="size-12 shrink-0 rounded-xl bg-fill-2" />
            <div className="min-w-0 space-y-1.5">
              <div className="flex h-[33px] items-center md:h-[37px]">
                <Skeleton className="h-7 w-56 max-w-full bg-fill-2" />
              </div>
              <div className="flex h-5 items-center">
                <Skeleton className="h-3 w-64 max-w-full bg-fill-2" />
              </div>
            </div>
          </div>
        </div>
        <BotSetupSkeleton />
      </>
    );
  }
  if (!bot) {
    return (
      <div className="space-y-4">
        <BackToBots />
        <p className="text-[14px] text-fg-3">{error?.message ?? "Bot not found."}</p>
      </div>
    );
  }
  const status = listed ? botStatus(listed.token) : null;
  return (
    <>
      <div className="space-y-5">
        <BackToBots />
        <div className="flex items-center gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-line">
            <Image src={`/${bot.platform}.svg`} alt="" width={22} height={22} />
          </span>
          <div className="min-w-0 space-y-1.5">
            <h1 className="truncate font-display text-[26px] leading-tight font-semibold tracking-[-0.025em] text-fg md:text-[30px]">
              {bot.name}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-3">
              {status ? (
                <StatusDot tone={status.tone} pulse={status.pulse}>
                  {status.label}
                </StatusDot>
              ) : null}
              {status ? <span className="text-fg-4">{status.detail}</span> : null}
              <span className="hidden text-fg-4 sm:inline">·</span>
              <span className="hidden sm:inline">{platformName(bot.platform)}</span>
              <span className="hidden truncate font-mono text-[12.5px] sm:inline">
                {repoParts(bot.repo).name}
              </span>
            </div>
          </div>
        </div>
      </div>
      <BotSetup key={bot.id} bot={bot} />
    </>
  );
}
