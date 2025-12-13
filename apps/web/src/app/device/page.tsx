"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL;

export default function DevicePage() {
	const [userCode, setUserCode] = useState("");
	const normalized = useMemo(() => userCode.trim().toUpperCase(), [userCode]);

	async function submit(action: "approve" | "deny") {
		if (!serverUrl) {
			toast.error("NEXT_PUBLIC_SERVER_URL is not set");
			return;
		}
		if (!normalized) {
			toast.error("Enter a code");
			return;
		}

		const res = await fetch(`${serverUrl}/api/device/approve`, {
			method: "POST",
			credentials: "include",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ userCode: normalized, action }),
		});

		if (!res.ok) {
			const data = (await res.json().catch(() => null)) as { error?: string } | null;
			toast.error(data?.error ?? "Failed");
			return;
		}

		toast.success(action === "approve" ? "Device approved" : "Device denied");
		setUserCode("");
	}

	return (
		<div className="mx-auto flex w-full max-w-xl flex-col gap-6 py-10">
			<Card>
				<CardHeader>
					<CardTitle>Device Login</CardTitle>
					<CardDescription>Approve a CLI login request by entering the code shown in your terminal.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="code">Code</Label>
						<Input
							id="code"
							placeholder="ABCD-EFGH"
							value={userCode}
							onChange={(e) => setUserCode(e.target.value)}
							autoCapitalize="characters"
							spellCheck={false}
						/>
						<p className="text-sm text-muted-foreground">We recommend only approving devices you control.</p>
					</div>

					<div className="flex gap-2">
						<Button onClick={() => submit("approve")}>Approve</Button>
						<Button variant="secondary" onClick={() => submit("deny")}>
							Deny
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
