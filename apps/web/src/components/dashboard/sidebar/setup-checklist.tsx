"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, X } from "lucide-react";
import { trpc } from "@/utils/trpc";
import { cn } from "@/lib/utils";

const DISMISSED_KEY = "gitterm:setup-dismissed";

type Step = { label: string; href: string; done: boolean };

/**
 * The three things every new account needs before an agent can do real work, shown until they
 * are done (or dismissed). Each step links to the one page that finishes it.
 */
export function SetupChecklist({ onNavigate }: { onNavigate?: () => void }) {
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => setDismissed(localStorage.getItem(DISMISSED_KEY) === "1"), []);

  const credentials = useQuery(trpc.modelCredentials.listMyCredentials.queryOptions());
  const integrations = useQuery(trpc.integrations.list.queryOptions());
  const connections = useQuery(trpc.integrations.connections.list.queryOptions());
  const workspaces = useQuery(
    trpc.workspace.listWorkspaces.queryOptions({ limit: 1, offset: 0, status: "all" }),
  );

  const loaded = credentials.data && integrations.data && connections.data && workspaces.data;
  if (dismissed || !loaded) return null;

  const githubEnabled = integrations.data.some(
    (integration) => integration.key === "github" && integration.enabled,
  );
  const steps: Step[] = [
    {
      label: "Add a model key",
      href: "/dashboard/models",
      done: credentials.data.credentials.some((credential) => credential.isActive),
    },
    ...(githubEnabled
      ? [
          {
            label: "Connect GitHub",
            href: "/dashboard/integrations",
            done: connections.data.some((connection) => connection.integration === "github"),
          },
        ]
      : []),
    {
      label: "Start a workspace or bot",
      href: "/dashboard",
      done: workspaces.data.workspaces.length > 0,
    },
  ];
  const completed = steps.filter((step) => step.done).length;
  if (completed === steps.length) return null;
  const next = steps.find((step) => !step.done);

  return (
    <div className="rise rounded-lg border border-line bg-fill p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary/90">
          Setup · {completed}/{steps.length}
        </span>
        <button
          type="button"
          aria-label="Hide setup"
          onClick={() => {
            localStorage.setItem(DISMISSED_KEY, "1");
            setDismissed(true);
          }}
          className="rounded p-0.5 text-fg-4 transition-colors hover:text-fg-2"
        >
          <X className="size-3" />
        </button>
      </div>
      <div className="mt-2 flex gap-1" aria-hidden="true">
        {steps.map((step) => (
          <span
            key={step.label}
            className={cn("h-0.5 flex-1 rounded-full", step.done ? "bg-primary" : "bg-fill-2")}
          />
        ))}
      </div>
      <ul className="mt-2.5 space-y-1">
        {steps.map((step) => {
          const isNext = step === next;
          return (
            <li key={step.label}>
              <Link
                href={step.href as Route}
                onClick={onNavigate}
                className={cn(
                  "group flex items-center gap-2 rounded px-1 py-0.5 text-xs transition-colors",
                  step.done ? "text-fg-4" : isNext ? "text-fg" : "text-fg-3 hover:text-fg-2",
                )}
              >
                <span
                  className={cn(
                    "flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                    step.done
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : isNext
                        ? "border-primary/60"
                        : "border-line-2",
                  )}
                >
                  {step.done ? <Check className="size-2.5" /> : null}
                </span>
                <span className={cn("truncate", step.done && "line-through decoration-line-2")}>
                  {step.label}
                </span>
                {isNext ? (
                  <ArrowRight className="ml-auto size-3 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
