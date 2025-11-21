"use client";
import { authClient } from "@/lib/auth-client";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";

export default function Dashboard({
	session,
}: {
	session: typeof authClient.$Infer.Session;
}) {
	const privateData = useQuery(trpc.privateData.queryOptions());

	return (
		<>
			<p>API: {privateData.data?.message}</p>
		</>
	);
}
