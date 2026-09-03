import { cache } from "react";
import { headers } from "next/headers";
import { authClient } from "@/lib/auth-client";

export const getServerSession = cache(async () => {
  const requestHeaders = await headers();
  const cookie = requestHeaders.get("cookie");

  return authClient.getSession({
    fetchOptions: {
      headers: cookie ? { cookie } : {},
    },
  });
});
