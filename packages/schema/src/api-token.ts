import { z } from "zod";

export const API_TOKEN_SCOPES = [
  "identity:read",
  "workspace:read",
  "workspace:access",
  "workspace:write",
  "run:read",
  "run:write",
] as const;

export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export const apiTokenScopeSchema = z.enum(API_TOKEN_SCOPES);
export const apiTokenScopesSchema = z
  .array(apiTokenScopeSchema)
  .min(1)
  .max(API_TOKEN_SCOPES.length);

export const CLI_API_TOKEN_SCOPES = [...API_TOKEN_SCOPES] satisfies ApiTokenScope[];

export const API_TOKEN_SCOPE_DETAILS: ReadonlyArray<{
  scope: ApiTokenScope;
  label: string;
  description: string;
}> = [
  { scope: "identity:read", label: "Identity", description: "Read your account identity" },
  { scope: "workspace:read", label: "Read workspaces", description: "List and inspect workspaces" },
  {
    scope: "workspace:access",
    label: "Access workspaces",
    description: "Retrieve runtime URLs, headers, and server credentials",
  },
  {
    scope: "workspace:write",
    label: "Manage workspaces",
    description: "Create, start, pause, restart, and terminate workspaces",
  },
  { scope: "run:read", label: "Read runs", description: "Inspect agent runs and messages" },
  { scope: "run:write", label: "Manage runs", description: "Create and cancel agent runs" },
];
