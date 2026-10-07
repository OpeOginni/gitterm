"use client";

import { useEffect } from "react";
import { captureException, useAnalyticsReady } from "@/lib/analytics";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const analyticsReady = useAnalyticsReady();
  useEffect(() => {
    if (analyticsReady) captureException(error);
  }, [error, analyticsReady]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        Please try again. If this keeps happening, contact support.
      </p>
      <Button type="button" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
