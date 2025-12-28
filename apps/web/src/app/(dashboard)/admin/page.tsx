"use client"

import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell"
import { Button } from "@/components/ui/button"
import { Users, Server, Image, Globe, ChevronRight, Settings } from "lucide-react"
import Link from "next/link"
import { trpcClient } from "@/utils/trpc"
import { useQuery } from "@tanstack/react-query"
import { Skeleton } from "@/components/ui/skeleton"
import type { Route } from "next"

export default function AdminPage() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => trpcClient.admin.users.stats.query(),
  })

  const navItems = [
    {
      href: "/admin/users" as Route,
      icon: Users,
      title: "User Management",
      description: "View, manage, and update user accounts and roles.",
    },
    {
      href: "/admin/providers" as Route,
      icon: Globe,
      title: "Cloud Providers",
      description: "Configure cloud providers and regions for workspaces.",
    },
    {
      href: "/admin/agents" as Route,
      icon: Server,
      title: "Agent Types",
      description: "Configure the types of agents users can deploy.",
    },
    {
      href: "/admin/images" as Route,
      icon: Image,
      title: "Container Images",
      description: "Manage Docker images used for workspaces.",
    },
    {
      href: "/admin/settings" as Route,
      icon: Settings,
      title: "System Settings",
      description: "Configure idle timeout, quotas, and other system settings.",
    },
  ]

  return (
    <DashboardShell>
      <DashboardHeader 
        heading="Admin Panel" 
        text="Manage infrastructure, users, and system settings." 
      />
      
      <div className="pt-8 space-y-8">
        {/* Stats Overview - Inline style */}
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4 py-6 border-b border-border/50">
        <div>
          <p className="text-sm text-muted-foreground">Total Users</p>
          {isLoading ? (
            <Skeleton className="h-8 w-16 mt-1" />
          ) : (
            <p className="text-2xl text-center font-semibold">{stats?.users.total ?? 0}</p>
          )}
          <p className="text-xs text-muted-foreground text-center">{stats?.users.admins ?? 0} admins</p>
        </div>
        
        <div>
          <p className="text-sm text-muted-foreground">Active Workspaces</p>
          {isLoading ? (
            <Skeleton className="h-8 w-16 mt-1" />
          ) : (
            <p className="text-2xl text-center font-semibold">{stats?.workspaces.running ?? 0}</p>
          )}
          <p className="text-xs text-muted-foreground text-center">{stats?.workspaces.total ?? 0} total</p>
        </div>
        
        <div>
          <p className="text-sm text-muted-foreground">Paid Users</p>
          {isLoading ? (
            <Skeleton className="h-8 w-16 mt-1" />
          ) : (
            <p className="text-2xl text-center font-semibold">{stats?.users.paid ?? 0}</p>
          )}
          <p className="text-xs text-muted-foreground text-center">{stats?.users.free ?? 0} free tier</p>
        </div>
        
        <div>
          <p className="text-sm text-muted-foreground">Stopped Workspaces</p>
          {isLoading ? (
            <Skeleton className="h-8 w-16 mt-1" />
          ) : (
            <p className="text-2xl text-center font-semibold">{stats?.workspaces.stopped ?? 0}</p>
          )}
          <p className="text-xs text-muted-foreground text-center">can be resumed</p>
        </div>
      </div>

        {/* Admin Sections - Clean list */}
        <div className="space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center justify-between p-4 rounded-lg hover:bg-muted transition-colors group"
            >
              <div className="flex items-center gap-4">
                <div className="p-2 rounded-md bg-muted/50 group-hover:bg-muted">
                  <item.icon className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium">{item.title}</p>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
            </Link>
          ))}
        </div>
      </div>
    </DashboardShell>
  )
}
