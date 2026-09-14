"use client";

import { useState, type ReactNode } from "react";
import {
  buildTaskRolePolicy,
  TASK_ROLE_ADDONS,
  type TaskRoleAddon,
} from "@gitterm/api/providers/aws/task-role-policy";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ConsoleLink, iamRoleConsoleUrl } from "./aws-console-link";
import { PolicyJsonViewer } from "./policy-json-viewer";

const ACCOUNT_PLACEHOLDER = "<ACCOUNT_ID>";

function PermissionRow({
  id,
  title,
  detail,
  control,
}: {
  id: string;
  title: string;
  detail: string;
  control: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-line bg-fill p-3">
      <div className="space-y-1">
        <Label htmlFor={id} className="text-sm font-medium text-fg">
          {title}
        </Label>
        <p className="text-xs leading-relaxed text-fg-3">{detail}</p>
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </div>
  );
}

/**
 * Shows the policy a workspace task role needs, with optional add-ons an admin
 * can toggle before copying the JSON into IAM.
 */
export function AwsRolePolicyDialog({ roleArn, trigger }: { roleArn: string; trigger: ReactNode }) {
  const [addons, setAddons] = useState<TaskRoleAddon[]>([]);
  const policy = JSON.stringify(buildTaskRolePolicy(roleArn, addons), null, 2);
  const roleName = roleArn.split("/").at(-1) || "gitterm-task-role";
  const isPlaceholder = roleArn.includes(ACCOUNT_PLACEHOLDER);

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Task role permissions</DialogTitle>
          <DialogDescription>
            What a workspace role needs, plus optional add-ons for the agent's own work. Attach the
            JSON in IAM. GitTerm never writes application permissions.
          </DialogDescription>
        </DialogHeader>

        <p className="break-all font-mono text-xs text-fg-3">{roleArn}</p>

        <div className="grid gap-3 md:grid-cols-2">
          <PermissionRow
            id="aws-role-baseline"
            title="Baseline · required"
            detail="Read-only discovery of this role and of managed policies. GitTerm adds it to roles it creates. Imported roles need it attached by you."
            control={<Switch id="aws-role-baseline" checked disabled />}
          />
          {(Object.keys(TASK_ROLE_ADDONS) as TaskRoleAddon[]).map((key) => (
            <PermissionRow
              key={key}
              id={`aws-role-addon-${key}`}
              title={TASK_ROLE_ADDONS[key].label}
              detail={TASK_ROLE_ADDONS[key].description}
              control={
                <Switch
                  id={`aws-role-addon-${key}`}
                  checked={addons.includes(key)}
                  onCheckedChange={(checked) =>
                    setAddons(checked ? [...addons, key] : addons.filter((addon) => addon !== key))
                  }
                />
              }
            />
          ))}
        </div>

        <PolicyJsonViewer value={policy} fileName={`${roleName}-policy.json`} height="280px" />

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs leading-relaxed text-fg-3">
          <p className="md:max-w-md">
            Need S3, Lambda or a database? Add those statements in IAM after attaching this one.
            {isPlaceholder && ` Replace ${ACCOUNT_PLACEHOLDER} with your account ID.`}
          </p>
          <ConsoleLink href={iamRoleConsoleUrl(roleArn)}>Open role in IAM</ConsoleLink>
        </div>
      </DialogContent>
    </Dialog>
  );
}
