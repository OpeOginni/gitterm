"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import type { AwsAccessProfile } from "@gitterm/schema";
import { trpcClient } from "@/utils/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { HelpHint } from "@/components/ui/help-hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConsoleLink, iamRoleConsoleUrl } from "./aws-console-link";
import { AwsRolePolicyDialog } from "./aws-role-policy-dialog";

export type AwsRoleSelection = { mode: "create"; name: string } | { mode: "existing"; arn: string };
type RoleCheck = Awaited<ReturnType<typeof trpcClient.admin.aws.checkAccessRole.mutate>>;

/** ARN the policy dialog should show for the current selection, with a placeholder until the account is known. */
export function previewRoleArn(value: AwsRoleSelection, accountId?: string) {
  if (value.mode === "existing" && /^arn:aws:iam::\d{12}:role\//.test(value.arn.trim())) {
    return value.arn.trim();
  }
  const name =
    value.mode === "create" && value.name.trim() !== "gitterm-task-"
      ? value.name.trim()
      : "gitterm-task-<name>";
  return `arn:aws:iam::${accountId ?? "<ACCOUNT_ID>"}:role/${name}`;
}

export function AwsRoleInput({
  value,
  onChange,
  disabled,
  id,
  accountId,
}: {
  value: AwsRoleSelection;
  onChange: (value: AwsRoleSelection) => void;
  disabled?: boolean;
  id: string;
  /** Known AWS account, used to preview the role's policy before it exists. */
  accountId?: string;
}) {
  return (
    <div className="space-y-3">
      <Label htmlFor={`${id}-mode`}>Task role</Label>
      <Select
        value={value.mode}
        onValueChange={(mode) =>
          onChange(mode === "create" ? { mode, name: "" } : { mode: "existing", arn: "" })
        }
        disabled={disabled}
      >
        <SelectTrigger id={`${id}-mode`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="existing">Use existing role</SelectItem>
          <SelectItem value="create">Create new role</SelectItem>
        </SelectContent>
      </Select>
      <Label htmlFor={`${id}-value`} className="text-xs text-muted-foreground">
        {value.mode === "create" ? "Role name" : "Role ARN"}
      </Label>
      <div className="flex items-center overflow-hidden rounded-md border border-input focus-within:ring-2 focus-within:ring-ring">
        {value.mode === "create" && (
          <span className="shrink-0 border-r border-input px-3 font-mono text-xs text-muted-foreground">
            gitterm-task-
          </span>
        )}
        <Input
          id={`${id}-value`}
          className="h-9 border-0 font-mono text-xs shadow-none focus-visible:ring-0 md:text-xs"
          aria-describedby={`${id}-hint`}
          disabled={disabled}
          value={value.mode === "create" ? value.name.replace(/^gitterm-task-/, "") : value.arn}
          onChange={(event) =>
            onChange(
              value.mode === "create"
                ? {
                    mode: "create",
                    name: `gitterm-task-${event.target.value.replace(/^gitterm-task-/, "")}`,
                  }
                : { mode: "existing", arn: event.target.value },
            )
          }
          placeholder={
            value.mode === "create"
              ? "development"
              : "arn:aws:iam::123456789012:role/gitterm-task-development"
          }
        />
      </div>
      <p id={`${id}-hint`} className="text-xs leading-relaxed text-muted-foreground">
        {value.mode === "create"
          ? "Creates a role with read-only discovery. Add application permissions in AWS."
          : "Validates the account and ECS trust. Your role stays unchanged."}
      </p>
      <AwsRolePolicyDialog
        roleArn={previewRoleArn(value, accountId)}
        trigger={
          <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs">
            View role permissions
          </Button>
        }
      />
    </div>
  );
}

export function AwsRoleCheckResult({ check }: { check: RoleCheck }) {
  return (
    <div className="mt-4 space-y-3 rounded-lg border border-line bg-fill p-4" role="status">
      <p className="text-sm font-medium">
        Capability discovery:{" "}
        {check.discovery === "available"
          ? "allowed in simulation"
          : check.discovery === "missing"
            ? "baseline not fully allowed"
            : "not verified"}
      </p>
      <p className="break-all font-mono text-xs text-muted-foreground">{check.roleArn}</p>
      {check.missingActions.length > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-300">
          Review: {check.missingActions.join(", ")}
        </p>
      )}
      {check.warnings.map((warning) => (
        <p key={warning} className="text-xs text-muted-foreground">
          {warning}
        </p>
      ))}
      <div className="flex flex-wrap gap-2">
        <AwsRolePolicyDialog
          roleArn={check.roleArn}
          trigger={
            <Button type="button" size="sm" variant="outline">
              View recommended policy
            </Button>
          }
        />
        <ConsoleLink href={iamRoleConsoleUrl(check.roleArn)}>Open role in IAM</ConsoleLink>
      </div>
    </div>
  );
}

function ProfileCard({
  name,
  description,
  roleArn,
  isDefault,
  disabled,
  onCheck,
  onRemove,
}: {
  name: string;
  description: string;
  roleArn: string;
  isDefault?: boolean;
  disabled: boolean;
  onCheck: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-fill p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-fg">{name}</p>
            {isDefault && (
              <Badge variant="outline" className="border-line-2 text-[10px] text-fg-3">
                Default
              </Badge>
            )}
          </div>
          <p className="text-xs leading-relaxed text-fg-3">{description}</p>
        </div>
        {onRemove && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 w-7 shrink-0 px-0 text-fg-4 hover:text-destructive"
            disabled={disabled}
            onClick={onRemove}
            aria-label={`Remove ${name}`}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
      <p className="break-all font-mono text-[11px] text-fg-4">{roleArn}</p>
      <div className="mt-auto flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onCheck}>
          Check permissions
        </Button>
        <AwsRolePolicyDialog
          roleArn={roleArn}
          trigger={
            <Button type="button" size="sm" variant="ghost">
              View policy
            </Button>
          }
        />
      </div>
    </div>
  );
}

export function AwsAccessProfiles({
  providerId,
  profiles,
  defaultRoleArn,
  disabled,
}: {
  providerId: string;
  profiles: AwsAccessProfile[];
  defaultRoleArn: string;
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [role, setRole] = useState<AwsRoleSelection>({ mode: "existing", arn: "" });
  const [check, setCheck] = useState<RoleCheck | null>(null);
  const accountId = /^arn:aws:iam::(\d{12}):/.exec(defaultRoleArn)?.[1];
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "provider", providerId] });
    // The developer catalog uses tRPC query keys; invalidate after list changes too.
    queryClient.invalidateQueries({
      predicate: (query) =>
        JSON.stringify(query.queryKey).includes("listCloudProviders") ||
        JSON.stringify(query.queryKey).includes("getWorkspaceCatalog"),
    });
  };
  const add = useMutation({
    mutationFn: () =>
      trpcClient.admin.aws.addAccessProfile.mutate({
        providerId,
        name: name.trim(),
        description: description.trim(),
        role,
      }),
    onSuccess: (data) => {
      setCheck(data.check);
      setName("");
      setDescription("");
      setRole({ mode: "existing", arn: "" });
      setIsAddOpen(false);
      refresh();
      toast.success("Access profile added for all users");
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (profileId: string) =>
      trpcClient.admin.aws.removeAccessProfile.mutate({ providerId, profileId }),
    onSuccess: () => {
      refresh();
      toast.success("Profile removed. Existing workspaces and IAM role are unchanged.");
    },
    onError: (error) => toast.error(error.message),
  });
  const verify = useMutation({
    mutationFn: (profileId?: string) =>
      trpcClient.admin.aws.checkAccessRole.mutate({ providerId, profileId }),
    onSuccess: setCheck,
    onError: (error) => toast.error(error.message),
  });
  const pending = disabled || add.isPending || remove.isPending || verify.isPending;
  const canAdd =
    !pending && !!name.trim() && !!(role.mode === "create" ? role.name.trim() : role.arn.trim());

  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">AWS access profiles</h2>
            <HelpHint label="How access profiles work">
              Profiles are IAM roles a user can pick when creating a workspace. Everyone who can use
              this provider sees every profile, so only add roles whose permissions you mean to
              share. Removing a profile stops new selections; existing workspaces and the IAM role
              are untouched.
            </HelpHint>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Each profile is an IAM role users can pick for a workspace. The provider default is
            always available.
          </p>
        </div>

        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button type="button" size="sm" disabled={pending}>
              <Plus />
              Add profile
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Add an access profile</DialogTitle>
              <DialogDescription>
                Give users another IAM role to choose from, for example one with Bedrock or S3
                access. It becomes visible to everyone who can use this provider.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="aws-profile-name">Profile name</Label>
                <Input
                  id="aws-profile-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                  disabled={pending}
                  placeholder="Sandbox application builder"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="aws-profile-description">What it can do</Label>
                <Input
                  id="aws-profile-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={500}
                  disabled={pending}
                  placeholder="Shown to users when they pick a profile. IAM stays authoritative."
                />
              </div>
              <AwsRoleInput
                id="aws-profile-role"
                value={role}
                onChange={setRole}
                disabled={pending}
                accountId={accountId}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAddOpen(false)}
                disabled={add.isPending}
              >
                Cancel
              </Button>
              <Button type="button" disabled={!canAdd} onClick={() => add.mutate()}>
                {add.isPending ? "Adding…" : "Add for all users"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <ProfileCard
          name="Provider default"
          description="Used when a workspace does not pick a profile."
          roleArn={defaultRoleArn}
          isDefault
          disabled={pending}
          onCheck={() => verify.mutate(undefined)}
        />
        {profiles.map((profile) => (
          <ProfileCard
            key={profile.id}
            name={profile.name}
            description={profile.description}
            roleArn={profile.roleArn}
            disabled={pending}
            onCheck={() => verify.mutate(profile.id)}
            onRemove={() => {
              if (
                window.confirm(
                  `Remove ${profile.name} from new workspace selections? Existing workspaces and the IAM role will not change.`,
                )
              )
                remove.mutate(profile.id);
            }}
          />
        ))}
        <button
          type="button"
          disabled={pending}
          onClick={() => setIsAddOpen(true)}
          className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-2 p-4 text-center text-xs text-fg-4 transition-colors hover:border-fg-4 hover:text-fg-2 disabled:pointer-events-none disabled:opacity-50"
        >
          <Plus className="size-4" />
          <span className="font-medium">Add a profile</span>
          <span className="max-w-56 leading-relaxed">
            A separate role with its own permissions that users can pick per workspace.
          </span>
        </button>
      </div>

      {check && <AwsRoleCheckResult check={check} />}
    </section>
  );
}
