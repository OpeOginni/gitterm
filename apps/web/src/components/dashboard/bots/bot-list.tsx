"use client";

import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ChevronRight } from "lucide-react";
import { trpc } from "@/utils/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** `owner/repo#branch` from a saved repository URL. */
const repoLabel = (repo: string) =>
  repo.replace(/^https?:\/\/github\.com\//, "").replace(/\.git(?=#|$)/, "");

type Token = { lastUsedAt: Date | string | null; revoked: boolean } | null;

/** When the bot last reached GitTerm with its token: it does so on start and on every request. */
function activity(token: Token): { text: string; live: boolean } {
  if (!token || token.revoked) return { text: "No token", live: false };
  if (!token.lastUsedAt) return { text: "Not started yet", live: false };
  const last = new Date(token.lastUsedAt);
  return {
    text: `Active ${formatDistanceToNow(last, { addSuffix: true })}`,
    live: Date.now() - last.getTime() < 15 * 60_000,
  };
}

export function BotList() {
  const router = useRouter();
  const { data: bots, isLoading } = useQuery(trpc.bots.list.queryOptions());
  // No bots yet: the setup flow is the page.
  const empty = !isLoading && bots?.length === 0;
  useEffect(() => {
    if (empty) router.replace("/dashboard/bots/new" as Route);
  }, [empty, router]);

  if (isLoading || empty) {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <Skeleton className="h-28 bg-fill" />
        <Skeleton className="h-28 bg-fill" />
      </div>
    );
  }

  if (!bots?.length) return null;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {bots.map((bot) => {
        const status = activity(bot.token);
        return (
          <Link
            key={bot.id}
            href={`/dashboard/bots/${bot.id}` as Route}
            className="group flex items-center gap-4 rounded-2xl border border-line bg-card p-4 transition-colors hover:border-fg-4"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-fill-2">
              <Image src={`/${bot.platform}.svg`} alt="" width={22} height={22} />
            </span>
            <span className="min-w-0 flex-1 space-y-1">
              <span className="block truncate text-[15px] font-medium text-fg">{bot.name}</span>
              <span className="block truncate font-mono text-xs text-fg-3">
                {repoLabel(bot.repo)}
              </span>
              <span className="flex items-center gap-3 text-xs text-fg-4">
                <span className="flex shrink-0 items-center gap-1.5">
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      status.live ? "bg-primary" : "bg-fg-4/60",
                    )}
                  />
                  {status.text}
                </span>
                <span className="truncate font-mono">{bot.model.split("/").pop()}</span>
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-fg-4 transition-colors group-hover:text-fg-2" />
          </Link>
        );
      })}
    </div>
  );
}
