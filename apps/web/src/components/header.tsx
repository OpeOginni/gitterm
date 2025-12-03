"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";
import { cn } from "@/lib/utils";
import type { Route } from "next";

export function Header() {
	const pathname = usePathname();
	
	const links = [
		{ to: "/", label: "Home" },
		{ to: "/dashboard", label: "Dashboard" },
		{ to: "/dashboard/profile", label: "Usage" },
	] as const;

	return (
		<div className="border-b">
			<div className="flex h-16 items-center px-6">
				<div className="flex items-center gap-8 flex-1">
					<Link href="/dashboard" className="font-bold text-xl">
						GitTerm
					</Link>
					<nav className="flex gap-6 text-sm font-medium">
						{links.slice(1).map(({ to, label }) => {
							const isActive = pathname === to;
							return (
								<Link 
									key={to} 
									href={to as Route}
									className={cn(
										"transition-colors hover:text-primary",
										isActive ? "text-primary" : "text-muted-foreground"
									)}
								>
									{label}
								</Link>
							);
						})}
					</nav>
				</div>
				<div className="flex items-center gap-4">
					<ModeToggle />
					<UserMenu />
				</div>
			</div>
		</div>
	);
}
