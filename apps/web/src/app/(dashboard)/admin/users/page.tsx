"use client";

import { useState } from "react";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { Panel, PanelRow } from "@/components/dashboard/kit";
import { SettingsEmpty } from "@/components/dashboard/settings/settings-page";
import { Seg } from "@/components/site/seg";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Plus, Search, Trash2, Users } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDate, timeAgo, useAdminGuard } from "../_components/admin";

type UserRole = "user" | "admin";

interface CreateUserForm {
  email: string;
  password: string;
  name: string;
  role: UserRole;
  /** Billing plan id; only sent when billing is enabled. */
  plan: string;
}

const initialCreateForm: CreateUserForm = {
  email: "",
  password: "",
  name: "",
  role: "user",
  plan: "free",
};

/** The list endpoint's largest page; filters by plan and role apply to the loaded page. */
const PAGE_SIZE = 100;

const compactTrigger =
  "h-8 min-w-0 gap-1.5 bg-transparent px-2.5 text-[13px] text-fg-2 capitalize hover:bg-fill-2";

export default function UsersPage() {
  const { ready, userId } = useAdminGuard();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [planFilter, setPlanFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState<"all" | UserRole>("all");
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createForm, setCreateForm] = useState<CreateUserForm>(initialCreateForm);

  const { data: config } = useQuery({
    queryKey: ["admin", "config"],
    queryFn: () => trpcClient.admin.config.query(),
    enabled: ready,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "users", search, page],
    queryFn: () =>
      trpcClient.admin.users.list.query({
        search: search || undefined,
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE,
      }),
    enabled: ready,
    placeholderData: keepPreviousData,
  });

  const billingPlans = data?.plans ?? [];

  const updateUser = useMutation({
    mutationFn: (params: { id: string; plan?: string; role?: UserRole }) =>
      trpcClient.admin.users.update.mutate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
      toast.success("User updated");
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteUser = useMutation({
    mutationFn: (id: string) => trpcClient.admin.users.delete.mutate({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
      setDeleteUserId(null);
      toast.success("User deleted");
    },
    onError: (error) => toast.error(error.message),
  });

  const createUser = useMutation({
    mutationFn: (params: CreateUserForm) => trpcClient.admin.users.create.mutate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
      setShowCreateDialog(false);
      setCreateForm(initialCreateForm);
      toast.success("User created");
    },
    onError: (error) => toast.error(error.message),
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createUser.mutate(createForm);
  };

  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const canCreateUsers = config?.auth.canCreateUsers ?? false;

  const pageUsers = data?.users ?? [];
  const users = pageUsers.filter(
    (user) =>
      (planFilter === "all" || (user.plan ?? "free") === planFilter) &&
      (roleFilter === "all" || ((user.role as UserRole | null) ?? "user") === roleFilter),
  );
  const filtered = planFilter !== "all" || roleFilter !== "all";
  const deleting = pageUsers.find((user) => user.id === deleteUserId);

  if (!ready) {
    return (
      <DashboardShell>
        <div className="flex h-64 items-center justify-center">
          <Skeleton className="h-8 w-48 bg-fill" />
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <DashboardHeader heading="Users" text="Everyone with an account on this deployment.">
        {/* Whether users can be added comes with the config: hold its place until then. */}
        {!config ? (
          <Skeleton className="h-10 w-[7.5rem] self-start rounded-lg bg-fill-2" />
        ) : (
          canCreateUsers && (
            <Button onClick={() => setShowCreateDialog(true)} className="gap-1.5 self-start">
              <Plus className="size-4" />
              Add user
            </Button>
          )
        )}
      </DashboardHeader>

      <div className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 lg:w-80">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-4" />
            <Input
              type="search"
              aria-label="Search by name or email"
              placeholder="Search by name or email"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              className="pl-9"
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 lg:ml-auto">
            {/* Plans come with the users; hold the filter's place until they load. */}
            {!data ? (
              <Skeleton className="h-10 w-[21rem] max-w-full rounded-[14px] bg-fill-2" />
            ) : billingPlans.length > 0 ? (
              <Seg
                ariaLabel="Filter by plan"
                value={planFilter}
                onChange={setPlanFilter}
                className="max-w-full overflow-x-auto [&>button]:min-h-8 [&>button]:px-3 [&>button]:text-[13px]"
                options={[
                  { value: "all", label: "All plans" },
                  ...billingPlans.map((plan) => ({
                    value: plan,
                    label: <span className="capitalize">{plan}</span>,
                  })),
                ]}
              />
            ) : null}
            <Seg
              ariaLabel="Filter by role"
              value={roleFilter}
              onChange={setRoleFilter}
              className="[&>button]:min-h-8 [&>button]:px-3 [&>button]:text-[13px]"
              options={[
                { value: "all", label: "Everyone" },
                { value: "admin", label: "Admins" },
              ]}
            />
          </div>
        </div>

        {isLoading ? (
          <Panel>
            {[...Array(5)].map((_, i) => (
              <PanelRow key={i}>
                <Skeleton className="size-8 shrink-0 rounded-full bg-fill-2" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40 bg-fill-2" />
                  <Skeleton className="h-3.5 w-56 max-w-full bg-fill-2" />
                </div>
              </PanelRow>
            ))}
          </Panel>
        ) : users.length === 0 ? (
          <div className="rounded-xl border border-line px-4 py-4 sm:px-5">
            <SettingsEmpty
              icon={<Users />}
              title={search || filtered ? "No users match" : "No users yet"}
              description={
                search || filtered ? "Try another name, email, or filter." : "Sign-ups appear here."
              }
            />
          </div>
        ) : (
          <Panel>
            {users.map((user) => {
              const role = (user.role as UserRole | null) ?? "user";
              const isSelf = user.id === userId;
              return (
                <PanelRow key={user.id} className="flex-wrap gap-y-2.5 sm:flex-nowrap">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-fill-2 text-[13px] font-medium text-fg-2">
                    {(user.name || user.email).charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1 basis-[calc(100%-3rem)] sm:basis-auto">
                    <p className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[14px] font-medium text-fg">{user.name}</span>
                      {isSelf ? (
                        <span className="shrink-0 text-[12.5px] text-fg-4">You</span>
                      ) : null}
                    </p>
                    <p className="truncate text-[13px] text-fg-3">{user.email}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 max-sm:basis-full max-sm:pl-[34px]">
                    {billingPlans.length > 0 ? (
                      <Select
                        value={user.plan ?? "free"}
                        onValueChange={(value) => updateUser.mutate({ id: user.id, plan: value })}
                      >
                        <SelectTrigger
                          size="sm"
                          aria-label={`Plan for ${user.name}`}
                          className={compactTrigger}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {billingPlans.map((plan) => (
                            <SelectItem key={plan} value={plan} className="capitalize">
                              {plan}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                    <Select
                      value={role}
                      disabled={isSelf}
                      onValueChange={(value: UserRole) =>
                        updateUser.mutate({ id: user.id, role: value })
                      }
                    >
                      <SelectTrigger
                        size="sm"
                        aria-label={`Role for ${user.name}`}
                        className={compactTrigger}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">User</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                    <span
                      className="w-24 text-right text-[12.5px] whitespace-nowrap text-fg-4 max-sm:mr-auto max-sm:w-auto max-sm:pl-2 max-sm:text-left"
                      title={`Joined ${formatDate(user.createdAt)}`}
                    >
                      {timeAgo(user.createdAt)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${user.name}`}
                      disabled={isSelf}
                      className="size-8 text-fg-3 hover:text-destructive"
                      onClick={() => setDeleteUserId(user.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </PanelRow>
              );
            })}
          </Panel>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-fg-4 tabular-nums">
            {!data
              ? null
              : filtered
                ? `${users.length} of ${pageUsers.length} shown`
                : totalPages > 1
                  ? `${page * PAGE_SIZE + 1} to ${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`
                  : `${total} ${total === 1 ? "user" : "users"}`}
            {filtered && totalPages > 1 ? " on this page" : null}
          </p>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => p - 1)}
                disabled={page === 0}
              >
                <ChevronLeft className="size-4" />
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages - 1}
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <form onSubmit={handleCreateSubmit}>
            <DialogHeader>
              <DialogTitle>Add user</DialogTitle>
              <DialogDescription>They sign in with this email and password.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="Ada Lovelace"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="ada@example.com"
                  value={createForm.email}
                  onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="At least 8 characters"
                  value={createForm.password}
                  onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                  minLength={8}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="role">Role</Label>
                  <Select
                    value={createForm.role}
                    onValueChange={(value: UserRole) =>
                      setCreateForm((f) => ({ ...f, role: value }))
                    }
                  >
                    <SelectTrigger id="role" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {billingPlans.length > 0 && (
                  <div className="grid gap-2">
                    <Label htmlFor="plan">Plan</Label>
                    <Select
                      value={createForm.plan}
                      onValueChange={(value) => setCreateForm((f) => ({ ...f, plan: value }))}
                    >
                      <SelectTrigger id="plan" className="w-full capitalize">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {billingPlans.map((plan) => (
                          <SelectItem key={plan} value={plan} className="capitalize">
                            {plan}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowCreateDialog(false);
                  setCreateForm(initialCreateForm);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createUser.isPending}>
                {createUser.isPending ? "Creating…" : "Create user"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteUserId} onOpenChange={() => setDeleteUserId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name ?? "user"}?</DialogTitle>
            <DialogDescription>
              Their account goes for good and all their workspaces are terminated.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteUserId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteUserId && deleteUser.mutate(deleteUserId)}
              disabled={deleteUser.isPending}
            >
              {deleteUser.isPending ? "Deleting…" : "Delete user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}
