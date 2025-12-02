import { QueryCache, QueryClient } from "@tanstack/react-query";
import {
	createTRPCClient,
	createTRPCProxyClient,
	httpBatchLink,
	httpSubscriptionLink,
	splitLink,
} from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { AppRouter, ListenerRouter } from "@gitpad/api/routers/index";
import { toast } from "sonner";

export const queryClient = new QueryClient({
	queryCache: new QueryCache({
		onError: (error) => {
			toast.error(error.message, {
				action: {
					label: "retry",
					onClick: () => {
						queryClient.invalidateQueries();
					},
				},
			});
		},
	}),
});

const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL;
const listenerUrl = process.env.NEXT_PUBLIC_LISTENER_URL;

if (!listenerUrl) {
	throw new Error("NEXT_PUBLIC_LISTENER_URL is not set");
}

if (!serverUrl) {
	throw new Error("NEXT_PUBLIC_SERVER_URL is not set");
}

export const trpcClient = createTRPCClient<AppRouter>({
	links: [
		httpBatchLink({
			url: `${serverUrl}/trpc`,
			fetch(url, options) {
				return fetch(url, {
					...options,
					credentials: "include",
				});
			},
		}),
	],
});

export const listenerTrpc = createTRPCProxyClient<ListenerRouter>({
	links: [
		httpSubscriptionLink({
			url: `${listenerUrl}/trpc`,
			eventSourceOptions: {
				withCredentials: true,
			},
		}),
	],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
	client: trpcClient,
	queryClient,
});
