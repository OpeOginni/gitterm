"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import type { AwsAccessProfile } from "@gitterm/schema";
import { trpcClient } from "@/utils/trpc";
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
import { LineCell, LineGrid, SectionHeading, StatusDot } from "@/components/dashboard/kit";
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
      <Label htmlFor={`${id}-value`} className="text-[13px] text-fg-3">
        {value.mode === "create" ? "Role name" : "Role ARN"}
      </Label>
      <div className="flex items-center overflow-hidden rounded-lg bg-input focus-within:ring-2 focus-within:ring-ring/45">
        {value.mode === "create" && (
          <span className="shrink-0 border-r border-line px-3 font-mono text-[13px] text-fg-3">
            gitterm-task-
          </span>
        )}
        <Input
          id={`${id}-value`}
          className="h-9 border-0 bg-transparent font-mono text-[13px] shadow-none focus-visible:ring-0 md:text-[13px] dark:bg-transparent"
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
      <p id={`${id}-hint`} className="text-[13px] leading-relaxed text-fg-3">
        {value.mode === "create"
          ? "Creates a role with read-only discovery. Add application permissions in AWS."
          : "Validates the account and ECS trust. Your role stays unchanged."}
      </p>
      <AwsRolePolicyDialog
        roleArn={previewRoleArn(value, accountId)}
        trigger={
          <Button type="button" variant="link" size="sm" className="h-auto px-0 text-[13px]">
            View role permissions
          </Button>
        }
      />
    </div>
  );
}

export function AwsRoleCheckResult({ check }: { check: RoleCheck }) {
  return (
    <div className="mt-4 space-y-3 border-t border-line pt-4" role="status">
      <p className="text-[14px] font-medium text-fg">
        Capability discovery:{" "}
        {check.discovery === "available"
          ? "allowed in simulation"
          : check.discovery === "missing"
            ? "baseline not fully allowed"
            : "not verified"}
      </p>
      <p className="break-all font-mono text-[13px] text-fg-3">{check.roleArn}</p>
      {check.missingActions.length > 0 && (
        <p className="text-[13px] text-[#fb923c]">Review: {check.missingActions.join(", ")}</p>
      )}
      {check.warnings.map((warning) => (
        <p key={warning} className="text-[13px] text-fg-3">
          {warning}
        </p>
      ))}
      <div className="flex flex-wrap gap-2">
        <AwsRolePolicyDialog
          roleArn={check.roleArn}
          trigger={
            <Button type="button" size="sm" variant="secondary">
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
    <LineCell className="gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[14px] font-medium text-fg">{name}</p>
            {isDefault && <StatusDot tone="busy">Default</StatusDot>}
          </div>
          <p className="text-[13px] leading-relaxed text-fg-3">{description}</p>
        </div>
        {onRemove && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="size-8 shrink-0 px-0 text-fg-3 hover:text-destructive"
            disabled={disabled}
            onClick={onRemove}
            aria-label={`Remove ${name}`}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
      <p className="break-all font-mono text-[12.5px] text-fg-3">{roleArn}</p>
      <div className="mt-auto flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={onCheck}>
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
    </LineCell>
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
    <section className="space-y-4">
      <SectionHeading
        title={
          <span className="inline-flex items-center gap-2">
            Access profiles
            <HelpHint label="How access profiles work">
              Profiles are IAM roles a user can pick when creating a workspace. Everyone who can use
              this provider sees every profile, so only add roles whose permissions you mean to
              share. Removing a profile stops new selections; existing workspaces and the IAM role
              are untouched.
            </HelpHint>
          </span>
        }
        count={profiles.length + 1}
        description="IAM roles users can pick for a workspace. The provider default is always there."
        action={
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button type="button" variant="secondary" disabled={pending}>
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
                  variant="secondary"
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
        }
      />

      <LineGrid className="md:grid-cols-2">
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
      </LineGrid>

      {check && <AwsRoleCheckResult check={check} />}
    </section>
  );
}
