"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { queryClient } from "@/utils/trpc";
import { ThemeProvider } from "./theme-provider";
import { Toaster } from "./ui/sonner";
import { WorkspaceStatusWatcherProvider } from "./workspace-status-watcher";
import { useIsMobile } from "@/hooks/use-mobile";

export default function Providers({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      forcedTheme="dark"
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        <WorkspaceStatusWatcherProvider>{children}</WorkspaceStatusWatcherProvider>
        {!isMobile && <ReactQueryDevtools />}
      </QueryClientProvider>
      <Toaster richColors position="top-right" />
    </ThemeProvider>
  );
}
