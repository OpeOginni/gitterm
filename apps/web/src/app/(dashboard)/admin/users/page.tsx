"use client"

import { useState } from "react"
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Search, ChevronLeft, ChevronRight, Shield, User as UserIcon, Trash2, Plus } from "lucide-react"
import type { Route } from "next"
import { trpcClient } from "@/utils/trpc"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import Link from "next/link"

type UserPlan = "free" | "tunnel" | "pro" | "enterprise"
type UserRole = "user" | "admin"

interface CreateUserForm {
  email: string
  password: string
  name: string
  role: UserRole
  plan: UserPlan
}

const initialCreateForm: CreateUserForm = {
  email: "",
  password: "",
  name: "",
  role: "user",
  plan: "free",
}

export default function UsersPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(0)
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [createForm, setCreateForm] = useState<CreateUserForm>(initialCreateForm)
  const limit = 20

  // Fetch admin config to check if user creation is allowed
  const { data: config } = useQuery({
    queryKey: ["admin", "config"],
    queryFn: () => trpcClient.admin.config.query(),
  })

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "users", search, page],
    queryFn: () => trpcClient.admin.users.list.query({
      search: search || undefined,
      offset: page * limit,
      limit,
    }),
  })

  const updateUser = useMutation({
    mutationFn: (params: { id: string; plan?: UserPlan; role?: UserRole }) => 
      trpcClient.admin.users.update.mutate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
      toast.success("User updated")
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const deleteUser = useMutation({
    mutationFn: (id: string) => trpcClient.admin.users.delete.mutate({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
      setDeleteUserId(null)
      toast.success("User deleted")
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const createUser = useMutation({
    mutationFn: (params: CreateUserForm) => 
      trpcClient.admin.users.create.mutate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
      setShowCreateDialog(false)
      setCreateForm(initialCreateForm)
      toast.success("User created successfully")
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    createUser.mutate(createForm)
  }

  const totalPages = Math.ceil((data?.total ?? 0) / limit)
  const canCreateUsers = config?.auth.canCreateUsers ?? false

  return (
    <DashboardShell>
      <DashboardHeader 
        heading="User Management" 
        text="View and manage all users in the system."
      >
        <div className="flex items-center gap-2">
          {canCreateUsers && (
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add User
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href={"/admin" as Route}>Back to Admin</Link>
          </Button>
        </div>
      </DashboardHeader>

      <div className="pt-8 space-y-6">
        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search users..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
            className="pl-9"
          />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="h-10 px-0 text-left align-middle text-sm font-medium text-muted-foreground">
                      User
                    </th>
                    <th className="h-10 px-4 text-left align-middle text-sm font-medium text-muted-foreground">
                      Plan
                    </th>
                    <th className="h-10 px-4 text-left align-middle text-sm font-medium text-muted-foreground">
                      Role
                    </th>
                    <th className="h-10 px-4 text-left align-middle text-sm font-medium text-muted-foreground">
                      Created
                    </th>
                    <th className="h-10 px-0 text-right align-middle text-sm font-medium text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data?.users.map((user) => (
                    <tr key={user.id} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                      <td className="py-4 pr-4">
                        <div>
                          <div className="font-medium">{user.name}</div>
                          <div className="text-sm text-muted-foreground">{user.email}</div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <Select
                          value={(user as any).plan || "free"}
                          onValueChange={(value: UserPlan) => {
                            updateUser.mutate({ id: user.id, plan: value })
                          }}
                        >
                          <SelectTrigger className="w-28 h-8 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="free">Free</SelectItem>
                            <SelectItem value="tunnel">Tunnel</SelectItem>
                            <SelectItem value="pro">Pro</SelectItem>
                            <SelectItem value="enterprise">Enterprise</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-4 py-4">
                        <Select
                          value={(user as any).role || "user"}
                          onValueChange={(value: UserRole) => {
                            updateUser.mutate({ id: user.id, role: value })
                          }}
                        >
                          <SelectTrigger className="w-24 h-8 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="user">
                              <div className="flex items-center gap-2">
                                <UserIcon className="h-3 w-3" />
                                User
                              </div>
                            </SelectItem>
                            <SelectItem value="admin">
                              <div className="flex items-center gap-2">
                                <Shield className="h-3 w-3" />
                                Admin
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-4 py-4 text-sm text-muted-foreground">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-4 pl-4 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteUserId(user.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {data?.users.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-muted-foreground">
                        No users found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-4 border-t border-border/30">
                <div className="text-sm text-muted-foreground">
                  Showing {page * limit + 1} to {Math.min((page + 1) * limit, data?.total ?? 0)} of {data?.total ?? 0}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPage(p => p - 1)}
                    disabled={page === 0}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Previous
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPage(p => p + 1)}
                    disabled={page >= totalPages - 1}
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create User Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <form onSubmit={handleCreateSubmit}>
            <DialogHeader>
              <DialogTitle>Add New User</DialogTitle>
              <DialogDescription>
                Create a new user account. The user will be able to log in with the email and password you provide.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="John Doe"
                  value={createForm.name}
                  onChange={(e) => setCreateForm(f => ({ ...f, name: e.target.value }))}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="john@example.com"
                  value={createForm.email}
                  onChange={(e) => setCreateForm(f => ({ ...f, email: e.target.value }))}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Minimum 8 characters"
                  value={createForm.password}
                  onChange={(e) => setCreateForm(f => ({ ...f, password: e.target.value }))}
                  minLength={8}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="role">Role</Label>
                  <Select
                    value={createForm.role}
                    onValueChange={(value: UserRole) => setCreateForm(f => ({ ...f, role: value }))}
                  >
                    <SelectTrigger id="role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">
                        <div className="flex items-center gap-2">
                          <UserIcon className="h-3 w-3" />
                          User
                        </div>
                      </SelectItem>
                      <SelectItem value="admin">
                        <div className="flex items-center gap-2">
                          <Shield className="h-3 w-3" />
                          Admin
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="plan">Plan</Label>
                  <Select
                    value={createForm.plan}
                    onValueChange={(value: UserPlan) => setCreateForm(f => ({ ...f, plan: value }))}
                  >
                    <SelectTrigger id="plan">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="free">Free</SelectItem>
                      <SelectItem value="tunnel">Tunnel</SelectItem>
                      <SelectItem value="pro">Pro</SelectItem>
                      <SelectItem value="enterprise">Enterprise</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => {
                  setShowCreateDialog(false)
                  setCreateForm(initialCreateForm)
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createUser.isPending}>
                {createUser.isPending ? "Creating..." : "Create User"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteUserId} onOpenChange={() => setDeleteUserId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this user? This action cannot be undone.
              All their workspaces will be terminated.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteUserId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteUserId && deleteUser.mutate(deleteUserId)}
              disabled={deleteUser.isPending}
            >
              {deleteUser.isPending ? "Deleting..." : "Delete User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  )
}
