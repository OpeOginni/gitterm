"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import type { AwsAccessProfile } from "@gitterm/schema";
import { trpcClient } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type AwsRoleSelection = { mode: "create"; name: string } | { mode: "existing"; arn: string };
type RoleCheck = Awaited<ReturnType<typeof trpcClient.admin.aws.checkAccessRole.mutate>>;

export function AwsRoleInput({
  value,
  onChange,
  disabled,
  id,
}: {
  value: AwsRoleSelection;
  onChange: (value: AwsRoleSelection) => void;
  disabled?: boolean;
  id: string;
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
      <Label htmlFor={`${id}-value`}>
        {value.mode === "create" ? "New IAM role name" : "Existing IAM role ARN"}
      </Label>
      <Input
        id={`${id}-value`}
        disabled={disabled}
        value={value.mode === "create" ? value.name : value.arn}
        onChange={(event) =>
          onChange(
            value.mode === "create"
              ? { mode: "create", name: event.target.value }
              : { mode: "existing", arn: event.target.value },
          )
        }
        placeholder={
          value.mode === "create"
            ? "gitterm-task-development"
            : "arn:aws:iam::123456789012:role/WorkspaceDevelopment"
        }
      />
      <p className="text-xs leading-relaxed text-muted-foreground">
        {value.mode === "create"
          ? "Creates ECS trust and read-only capability discovery only. No S3, Lambda or Bedrock access is granted. Add application permissions in AWS. An existing name is rejected; use its ARN instead."
          : "Checks account and ECS trust without modifying the role. Discovery checks are advisory; missing permissions are shown after import and can be reviewed in AWS."}{" "}
        Allow the role in your control-plane IAM role-management and PassRole policies.
      </p>
    </div>
  );
}

export function AwsRoleCheckResult({ check }: { check: RoleCheck }) {
  return (
    <div
      className="mt-4 space-y-3 rounded-lg border border-border bg-foreground/[0.02] p-4"
      role="status"
    >
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
      <a
        className="inline-block text-xs underline"
        target="_blank"
        rel="noreferrer"
        href={`https://console.aws.amazon.com/iam/home#/roles/details/${encodeURIComponent(check.roleArn.split("/").at(-1)!)}`}
      >
        Open role in AWS Console
      </a>
      <details>
        <summary className="cursor-pointer text-xs font-medium">
          Recommended read-only discovery policy (review in AWS)
        </summary>
        <p className="mt-2 text-xs text-muted-foreground">
          The first statement reads only this role. The second reads managed-policy documents
          account-wide, including AWS-managed policies. It grants no application access and no IAM
          writes.
        </p>
        <pre className="mt-2 max-h-72 overflow-auto rounded border border-border p-3 text-xs">
          {JSON.stringify(check.recommendedPolicy, null, 2)}
        </pre>
      </details>
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
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [role, setRole] = useState<AwsRoleSelection>({ mode: "existing", arn: "" });
  const [check, setCheck] = useState<RoleCheck | null>(null);
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
      refresh();
      toast.success("AWS access profile added for all users");
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
  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">AWS access profiles</h2>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Every profile is selectable by all users who can use this AWS provider. Only add roles whose
        permissions you intend to share. Removing a profile blocks new selections; it does not
        revoke existing workspaces or delete the IAM role.
      </p>
      <div className="mt-4 divide-y divide-border rounded-lg border border-border">
        {[
          {
            id: "default",
            name: "Provider default role",
            description: "Used when no access profile is selected.",
            roleArn: defaultRoleArn,
          },
          ...profiles,
        ].map((profile) => (
          <div key={profile.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">{profile.name}</p>
              <p className="text-xs text-muted-foreground">{profile.description}</p>
              <p className="break-all font-mono text-[11px] text-muted-foreground">
                {profile.roleArn}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => verify.mutate(profile.id === "default" ? undefined : profile.id)}
              >
                Check permissions
              </Button>
              {profile.id !== "default" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Remove ${profile.name} from new workspace selections? Existing workspaces and the IAM role will not change.`,
                      )
                    )
                      remove.mutate(profile.id);
                  }}
                  aria-label={`Remove ${profile.name}`}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
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
          <Label htmlFor="aws-profile-description">Capabilities description</Label>
          <Input
            id="aws-profile-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={500}
            disabled={pending}
            placeholder="Describe intended access; IAM remains authoritative"
          />
        </div>
        <AwsRoleInput id="aws-profile-role" value={role} onChange={setRole} disabled={pending} />
      </div>
      <Button
        className="mt-4"
        variant="outline"
        disabled={
          pending || !name.trim() || !(role.mode === "create" ? role.name.trim() : role.arn.trim())
        }
        onClick={() => add.mutate()}
      >
        <Plus />
        {add.isPending ? "Adding role…" : "Add for all users"}
      </Button>
      {check && <AwsRoleCheckResult check={check} />}
    </section>
  );
}
