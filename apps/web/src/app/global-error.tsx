"use client";

import { useEffect } from "react";
import NextError from "next/error";
import { captureException } from "@/lib/analytics";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    captureException(error);
  }, [error]);
  return (
    <html lang="en">
      <body>
        <NextError statusCode={500} />
      </body>
    </html>
  );
}
