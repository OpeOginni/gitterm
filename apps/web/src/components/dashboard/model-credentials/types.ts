import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@gitterm/api/routers/index";

type Outputs = inferRouterOutputs<AppRouter>["modelCredentials"];

export type ModelProvider = Outputs["listProviders"]["providers"][number];
export type ModelCredential = Outputs["listMyCredentials"]["credentials"][number];

/** First free label for a provider: "default", then "default-2", … */
export function suggestLabel(
  credentials: ModelCredential[],
  providerId: string | undefined,
  base = "default",
): string {
  const taken = new Set(
    credentials
      .filter((credential) => credential.providerId === providerId)
      .map((credential) => credential.label),
  );
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

export function isLabelTaken(
  credentials: ModelCredential[],
  providerId: string | undefined,
  label: string,
): boolean {
  const normalized = label.trim();
  return credentials.some(
    (credential) => credential.providerId === providerId && credential.label === normalized,
  );
}
