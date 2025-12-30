"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { Terminal } from "lucide-react";
import Link from "next/link";

function LoginContent() {
	const searchParams = useSearchParams();
	const redirect = searchParams.get("redirect");

	return (
		<div className="min-h-screen bg-background flex flex-col">
			{/* Header */}
			<header className="border-b border-border bg-background/80 backdrop-blur-md">
				<div className="mx-auto flex h-16 max-w-6xl items-center px-6">
					<Link href="/" className="flex items-center gap-2">
						<Terminal className="h-6 w-6 text-primary" />
						<span className="text-lg font-semibold text-foreground">GitTerm</span>
					</Link>
				</div>
			</header>

			{/* Main content */}
			<div className="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
				<div className="w-full max-w-md space-y-8">
					{/* Logo/Brand */}
					<div className="flex flex-col items-center gap-4">
						<div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20">
							<Terminal className="h-8 w-8 text-primary" />
						</div>
						<div className="text-center">
							<h1 className="text-3xl font-bold tracking-tight text-foreground">
								Let's get you started
							</h1>
							<p className="mt-2 text-muted-foreground">
								Sign in to access your workspaces
							</p>
						</div>
					</div>

					{/* Auth Form */}
					<AuthForm redirectUrl={redirect ?? undefined} />

					{/* Footer text */}
					<p className="text-center text-sm text-muted-foreground">
						By signing in, you agree to our{" "}
						<Link href="#" className="text-primary hover:underline">
							Terms of Service
						</Link>{" "}
						and{" "}
						<Link href="#" className="text-primary hover:underline">
							Privacy Policy
						</Link>
					</p>
				</div>
			</div>
		</div>
	);
}

export default function LoginPage() {
	return (
		<Suspense fallback={
			<div className="min-h-screen bg-background flex items-center justify-center">
				<Terminal className="h-8 w-8 animate-pulse text-primary" />
			</div>
		}>
			<LoginContent />
		</Suspense>
	);
}
