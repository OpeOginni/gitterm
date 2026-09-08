"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, Loader2, Network, ShieldCheck } from "lucide-react";
import { awsRoleSelectionSchema } from "@gitterm/schema";
import { trpcClient } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AwsRoleSelection } from "./aws-access-profiles";
import { ConsoleLink, IAM_CONSOLE } from "./aws-console-link";
import { PolicyJsonViewer } from "./policy-json-viewer";

function Step({
  number,
  title,
  detail,
  action,
  children,
}: {
  number: number;
  title: string;
  detail: string;
  /** Rendered beside the text on wide screens, below it on narrow ones. */
  action?: ReactNode;
  /** Rendered full-width under the row. */
  children?: ReactNode;
}) {
  return (
    <li className="relative pl-10 pb-7 last:pb-0 after:absolute after:top-7 after:bottom-0 after:left-3 after:w-px after:bg-line last:after:hidden">
      <span
        aria-hidden
        className="absolute top-0 left-0 flex size-6 items-center justify-center rounded-full border border-line-2 bg-surface-2 text-xs font-semibold text-fg"
      >
        {number}
      </span>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-8">
        <div className="space-y-1 md:max-w-sm">
          <p className="text-sm font-medium leading-6 text-fg">{title}</p>
          <p className="text-xs leading-relaxed text-fg-3">{detail}</p>
        </div>
        {action && <div className="shrink-0 md:pt-0.5">{action}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </li>
  );
}

export function AwsSetupGuide({ region, role }: { region: string; role: AwsRoleSelection }) {
  const [open, setOpen] = useState(false);
  // The account ID is implied by an existing role ARN, so prefill it until the admin types.
  const arnAccountId =
    role.mode === "existing" ? /^arn:aws:iam::(\d{12}):role\//.exec(role.arn)?.[1] : undefined;
  const [typedAccountId, setTypedAccountId] = useState<string | null>(null);
  const accountId = typedAccountId ?? arnAccountId ?? "";
  const isAccountValid = /^\d{12}$/.test(accountId);
  const isRoleValid = awsRoleSelectionSchema.safeParse(role).success;
  const taskRoleLabel =
    role.mode === "existing" ? role.arn : role.name.trim() || `gitterm-task-${region}`;

  const blocker = !region
    ? "Set a default region for this provider first."
    : !isRoleValid
      ? "Fix the task role on the provider form first."
      : accountId && !isAccountValid
        ? "Account IDs are 12 digits."
        : null;

  const { data, isFetching, error } = useQuery({
    queryKey: ["admin", "aws-deployment-policy", accountId, region, role],
    queryFn: () => trpcClient.admin.aws.deploymentPolicy.query({ accountId, region, role }),
    enabled: open && isAccountValid && !blocker,
    staleTime: Infinity,
    retry: false,
  });
  const policy = data?.policy;

  return (
    <section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-fill p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-fill-2 p-2 text-fg-2">
          <ShieldCheck className="size-4" />
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-fg">Control-plane credentials</h3>
          <p className="text-xs text-fg-3">
            A dedicated IAM user with a policy generated for this provider.
          </p>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" size="sm" variant="outline">
            Setup & IAM policy
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Connect an AWS account</DialogTitle>
            <DialogDescription>
              Four steps. Use a dedicated IAM user, never your root credentials.
            </DialogDescription>
          </DialogHeader>

          <ol className="mt-2">
            <Step
              number={1}
              title="Generate the policy"
              detail="Enter your 12-digit AWS account ID. The policy is scoped to this provider's region and task role."
              action={
                <div className="flex items-center gap-2 md:w-80">
                  <Label htmlFor="aws-policy-account" className="sr-only">
                    AWS account ID
                  </Label>
                  <Input
                    id="aws-policy-account"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="AWS account ID, e.g. 123456789012"
                    value={accountId}
                    onChange={(event) =>
                      setTypedAccountId(event.target.value.replace(/\D/g, "").slice(0, 12))
                    }
                    className="h-9 font-mono text-xs md:text-xs"
                    aria-describedby="aws-policy-scope"
                    aria-invalid={!!accountId && !isAccountValid}
                  />
                  {isFetching && (
                    <Loader2
                      className="size-3.5 shrink-0 animate-spin text-fg-4"
                      aria-label="Generating policy"
                    />
                  )}
                </div>
              }
            >
              <p id="aws-policy-scope" className="text-xs leading-relaxed text-fg-4">
                {blocker ?? (
                  <>
                    {typedAccountId === null && arnAccountId && "Account taken from the role ARN. "}
                    Region <span className="font-mono text-fg-2">{region}</span> · Task role{" "}
                    <span className="break-all font-mono text-fg-2">{taskRoleLabel}</span>.
                    Regenerate if either changes.
                  </>
                )}
              </p>
              {error && (
                <p role="alert" className="mt-1 text-xs text-destructive">
                  {error.message}
                </p>
              )}
              {policy && (
                <div className="mt-3 space-y-2">
                  <PolicyJsonViewer
                    value={policy}
                    fileName={`gitterm-iam-${accountId}-${region}.json`}
                    height="220px"
                  />
                  <p className="text-xs leading-relaxed text-fg-4">
                    A deployment baseline, not a certified least-privilege policy. Some regional
                    actions use wildcard resources. Review it with your AWS administrator.
                  </p>
                </div>
              )}
            </Step>

            <Step
              number={2}
              title="Create the policy in IAM"
              detail="Create a customer-managed policy and paste the JSON into its editor."
              action={
                <ConsoleLink href={`${IAM_CONSOLE}/policies/create`}>Open IAM policies</ConsoleLink>
              }
            />

            <Step
              number={3}
              title="Create a user and attach the policy"
              detail="No console access needed. Attach the policy you just created."
              action={
                <ConsoleLink href={`${IAM_CONSOLE}/users/create`}>Open IAM users</ConsoleLink>
              }
            />

            <Step
              number={4}
              title="Create an access key and paste it here"
              detail="Choose “Application running outside AWS”. Close this dialog and enter the key ID and secret in the credential fields."
              action={
                <DialogClose asChild>
                  <Button type="button" size="sm">
                    Done, enter credentials
                  </Button>
                </DialogClose>
              }
            />
          </ol>

          <ul className="space-y-2 border-t border-line pt-4 text-xs leading-relaxed text-fg-3">
            <li className="flex gap-2.5">
              <KeyRound className="mt-0.5 size-3.5 shrink-0 text-fg-4" aria-hidden />
              <span>
                These keys manage infrastructure. Keep them out of workspaces and rotate them
                regularly.
              </span>
            </li>
            <li className="flex gap-2.5">
              <Network className="mt-0.5 size-3.5 shrink-0 text-fg-4" aria-hidden />
              <span>
                Provisioning needs a default VPC with public subnets in two availability zones.
              </span>
            </li>
          </ul>
        </DialogContent>
      </Dialog>
    </section>
  );
}
