"use client";

import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import { DashboardHeader } from "@/components/dashboard/shell";
import { Skeleton } from "@/components/ui/skeleton";
import { BotSetup } from "./bot-setup";

/** A saved bot's page: its settings to edit, and its .env and run commands again. */
export function BotEditor({ id }: { id: string }) {
  const { data: bot, isLoading, error } = useQuery(trpc.bots.get.queryOptions({ id }));

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64 bg-fill" />
        <Skeleton className="h-40 w-full bg-fill" />
      </div>
    );
  }
  if (!bot) {
    return (
      <p className="text-sm text-fg-3">
        {error?.message ?? "Bot not found."}{" "}
        <Link href={"/dashboard/bots" as Route} className="text-fg-2 underline underline-offset-2">
          Back to bots
        </Link>
      </p>
    );
  }
  return (
    <>
      <DashboardHeader
        heading={bot.name}
        text="Changes apply the next time the bot starts. The .env and run commands are below."
      />
      <BotSetup key={bot.id} bot={bot} />
    </>
  );
}
