/**
 * Unified "connection" model over every integration a user can attach to a workspace.
 *
 * A connection is either personal (a row owned by the user, e.g. a GitHub App installation
 * or a Google Cloud identity) or shared (admin-provided for the whole deployment, e.g. the
 * global GitHub PAT). Both are addressed by a single opaque `id`, so workspace creation
 * takes `connections: string[]` and never needs a new field per integration.
 *
 * Personal connection ids are the underlying row UUIDs. Shared connection ids are stable
 * and well-known: `<integration>:shared`.
 */
import { TRPCError } from "@trpc/server";
import { and, db, eq } from "@gitterm/db";
import {
  gitIntegration,
  githubAppInstallation,
  googleCloudIntegration,
} from "@gitterm/db/schema/integrations";
import { z } from "zod";
import env from "@gitterm/env/server";
import { apiPath } from "@gitterm/schema/url";
import { githubGlobalPat, githubRepositoryMode } from "../github/config";
import { getGitHubAppService } from "../github";
import {
  googleAudience,
  googlePrincipalSet,
  isWorkloadIdentityAvailable,
  workloadIdentityIssuer,
} from "../workload-identity/google";
import {
  INTEGRATIONS,
  integrationCatalog,
  integrationPolicy,
  type IntegrationKey,
} from "./catalog";

export type ConnectionKind = "personal" | "shared";
export type ConnectionStatus = "connected" | "suspended";

export type GitHubConnectionDetails = {
  integration: "github";
  /** `app` = user's GitHub App installation; `pat` = admin's deployment-wide token. */
  mode: "app" | "pat";
  accountLogin: string;
  accountType?: string;
  repositorySelection?: "all" | "selected";
  /** GitHub installation id (app mode only). */
  installationId?: string;
  /** Last characters of the shared PAT (pat mode only). */
  patSuffix?: string;
};

export type GoogleConnectionDetails = {
  integration: "google";
  projectId: string;
  serviceAccountEmail: string;
  workloadIdentityProvider: string;
  setup: {
    issuer: string;
    audience: string;
    principalSet: string;
    attributeMapping: Record<string, string>;
  };
};

export type ConnectionDetails = GitHubConnectionDetails | GoogleConnectionDetails;

export type Connection = {
  id: string;
  integration: IntegrationKey;
  kind: ConnectionKind;
  name: string;
  status: ConnectionStatus;
  connectedAt: Date;
  details: ConnectionDetails;
};

const SHARED_SUFFIX = ":shared";

export function sharedConnectionId(integration: IntegrationKey): string {
  return `${integration}${SHARED_SUFFIX}`;
}

export function parseSharedConnectionId(id: string): IntegrationKey | null {
  if (!id.endsWith(SHARED_SUFFIX)) return null;
  const key = id.slice(0, -SHARED_SUFFIX.length);
  return key in INTEGRATIONS ? (key as IntegrationKey) : null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

async function githubPersonalConnections(userId: string): Promise<Connection[]> {
  const policy = await integrationPolicy("github");
  if (!policy.enabled || !policy.allowPersonal) return [];
  if ((await githubRepositoryMode())?.mode !== "app") return [];

  const rows = await db
    .select()
    .from(gitIntegration)
    .innerJoin(
      githubAppInstallation,
      eq(gitIntegration.providerInstallationId, githubAppInstallation.installationId),
    )
    .where(
      and(
        eq(gitIntegration.userId, userId),
        eq(githubAppInstallation.userId, userId),
        eq(gitIntegration.active, true),
      ),
    );

  return rows.map(({ git_integration, github_app_installation }) => ({
    id: git_integration.id,
    integration: "github",
    kind: "personal",
    name: `${github_app_installation.accountLogin} (GitHub App)`,
    status: github_app_installation.suspended ? "suspended" : "connected",
    connectedAt: git_integration.connectedAt,
    details: {
      integration: "github",
      mode: "app",
      accountLogin: github_app_installation.accountLogin,
      accountType: github_app_installation.accountType,
      repositorySelection: github_app_installation.repositorySelection as "all" | "selected",
      installationId: github_app_installation.installationId,
    },
  }));
}

async function githubSharedConnection(): Promise<Connection | null> {
  const policy = await integrationPolicy("github");
  if (!policy.enabled || !policy.allowShared) return null;
  const mode = await githubRepositoryMode();
  if (mode?.mode !== "pat") return null;
  return {
    id: sharedConnectionId("github"),
    integration: "github",
    kind: "shared",
    name: `${mode.accountLogin} (shared PAT)`,
    status: "connected",
    connectedAt: new Date(0),
    details: {
      integration: "github",
      mode: "pat",
      accountLogin: mode.accountLogin,
      patSuffix: mode.patSuffix,
    },
  };
}

async function googleConnection(
  row: typeof googleCloudIntegration.$inferSelect,
  issuer: string,
): Promise<Connection> {
  return {
    id: row.id,
    integration: "google",
    kind: "personal",
    name: row.name,
    status: "connected",
    connectedAt: row.connectedAt,
    details: {
      integration: "google",
      projectId: row.projectId,
      serviceAccountEmail: row.serviceAccountEmail,
      workloadIdentityProvider: row.workloadIdentityProvider,
      setup: {
        issuer,
        audience: googleAudience(row.workloadIdentityProvider),
        principalSet: googlePrincipalSet(row),
        attributeMapping: {
          "google.subject": "assertion.sub",
          "attribute.integration_id": "assertion.integration_id",
        },
      },
    },
  };
}

async function googleAvailable(): Promise<boolean> {
  const policy = await integrationPolicy("google");
  return policy.enabled && policy.allowPersonal && (await isWorkloadIdentityAvailable());
}

async function googlePersonalConnections(userId: string): Promise<Connection[]> {
  if (!(await googleAvailable())) return [];
  const issuer = await workloadIdentityIssuer();
  const rows = await db
    .select()
    .from(googleCloudIntegration)
    .where(and(eq(googleCloudIntegration.userId, userId), eq(googleCloudIntegration.active, true)));
  return Promise.all(rows.map((row) => googleConnection(row, issuer)));
}

export async function listConnections(
  userId: string,
  filter?: { integration?: IntegrationKey; kind?: ConnectionKind },
): Promise<Connection[]> {
  const wanted = (key: IntegrationKey) => !filter?.integration || filter.integration === key;
  const [githubPersonal, githubShared, google] = await Promise.all([
    wanted("github") ? githubPersonalConnections(userId) : [],
    wanted("github") ? githubSharedConnection() : null,
    wanted("google") ? googlePersonalConnections(userId) : [],
  ]);
  const all = [...githubPersonal, ...(githubShared ? [githubShared] : []), ...google];
  return filter?.kind ? all.filter((connection) => connection.kind === filter.kind) : all;
}

export async function getConnection(userId: string, id: string): Promise<Connection | null> {
  const shared = parseSharedConnectionId(id);
  if (shared === "github") return githubSharedConnection();
  if (shared) return null;
  if (!UUID_PATTERN.test(id)) return null;
  const [github, google] = await Promise.all([
    githubPersonalConnections(userId),
    googlePersonalConnections(userId),
  ]);
  return [...github, ...google].find((connection) => connection.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Attaching to a workspace
// ---------------------------------------------------------------------------

export type ResolvedWorkspaceConnections = {
  github?:
    | { kind: "personal"; connectionId: string; gitIntegration: typeof gitIntegration.$inferSelect }
    | { kind: "shared"; connectionId: string; pat: string };
  google?: { connectionId: string; integration: typeof googleCloudIntegration.$inferSelect };
};

/**
 * Validate a workspace's requested connection ids: each must exist, be usable by this user
 * under the current admin policy, and at most one connection per integration may be attached.
 */
export async function resolveWorkspaceConnections(
  userId: string,
  ids: readonly string[],
): Promise<ResolvedWorkspaceConnections> {
  const resolved: ResolvedWorkspaceConnections = {};
  const seen = new Set<IntegrationKey>();

  for (const id of new Set(ids)) {
    const connection = await getConnection(userId, id);
    if (!connection) {
      throw new TRPCError({ code: "NOT_FOUND", message: `Connection not found: ${id}` });
    }
    if (connection.status !== "connected") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Connection ${connection.name} is ${connection.status}`,
      });
    }
    if (seen.has(connection.integration)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Only one ${INTEGRATIONS[connection.integration].name} connection can be attached`,
      });
    }
    seen.add(connection.integration);

    if (connection.integration === "github") {
      if (connection.kind === "shared") {
        const pat = await githubGlobalPat();
        if (!pat) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The admin's shared GitHub PAT is not configured",
          });
        }
        resolved.github = { kind: "shared", connectionId: connection.id, pat };
      } else {
        const [row] = await db
          .select()
          .from(gitIntegration)
          .where(and(eq(gitIntegration.id, connection.id), eq(gitIntegration.userId, userId)));
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Git integration not found" });
        resolved.github = { kind: "personal", connectionId: connection.id, gitIntegration: row };
      }
    } else if (connection.integration === "google") {
      const [row] = await db
        .select()
        .from(googleCloudIntegration)
        .where(
          and(
            eq(googleCloudIntegration.id, connection.id),
            eq(googleCloudIntegration.userId, userId),
            eq(googleCloudIntegration.active, true),
          ),
        );
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Google Cloud integration not found" });
      }
      resolved.google = { connectionId: connection.id, integration: row };
    }
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Creating / removing personal connections
// ---------------------------------------------------------------------------

const googleProviderPattern =
  /^projects\/[0-9]+\/locations\/global\/workloadIdentityPools\/[A-Za-z0-9_-]+\/providers\/[A-Za-z0-9_-]+$/;
const googleServiceAccountPattern =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?@[A-Za-z0-9-]+\.iam\.gserviceaccount\.com$/;

export const googleConnectionInput = z.object({
  integration: z.literal("google"),
  name: z.string().trim().min(1).max(100),
  projectId: z
    .string()
    .trim()
    .min(1)
    .max(63)
    .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/),
  workloadIdentityProvider: z.string().trim().regex(googleProviderPattern),
  serviceAccountEmail: z.string().trim().toLowerCase().regex(googleServiceAccountPattern),
});

export const githubConnectionInput = z.object({
  integration: z.literal("github"),
});

export const createConnectionInput = z.discriminatedUnion("integration", [
  googleConnectionInput,
  githubConnectionInput,
]);

export type CreateConnectionInput = z.infer<typeof createConnectionInput>;

export type CreateConnectionResult =
  | {
      status: "connected";
      connection: Connection;
      /** Commands the user still has to run outside GitTerm (e.g. Google IAM binding). */
      nextSteps: Array<{ label: string; command: string }>;
    }
  | {
      /** The provider needs a browser step; poll `listConnections` until it appears. */
      status: "pending";
      integration: IntegrationKey;
      authorizeUrl: string;
    };

function githubAppCallbackUrl(): string {
  return apiPath(env.API_URL || env.BASE_URL || `http://${env.BASE_DOMAIN}`, "github/callback");
}

export async function createConnection(
  userId: string,
  input: CreateConnectionInput,
): Promise<CreateConnectionResult> {
  const policy = await integrationPolicy(input.integration);
  if (!policy.enabled || !policy.allowPersonal) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `${INTEGRATIONS[input.integration].name} personal connections are not enabled by an admin`,
    });
  }

  if (input.integration === "google") {
    if (!(await isWorkloadIdentityAvailable())) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Google Cloud is not configured by an admin",
      });
    }
    const [row] = await db
      .insert(googleCloudIntegration)
      .values({
        userId,
        name: input.name,
        projectId: input.projectId,
        workloadIdentityProvider: input.workloadIdentityProvider,
        serviceAccountEmail: input.serviceAccountEmail,
        active: true,
      })
      .returning();
    const connection = await googleConnection(row!, await workloadIdentityIssuer());
    const details = connection.details as GoogleConnectionDetails;
    return {
      status: "connected",
      connection,
      nextSteps: [
        {
          label: "Allow this identity to impersonate the service account",
          command: `gcloud iam service-accounts add-iam-policy-binding '${details.serviceAccountEmail}' --project='${details.projectId}' --role='roles/iam.workloadIdentityUser' --member='${details.setup.principalSet}'`,
        },
      ],
    };
  }

  // GitHub App installs complete in the browser; the callback creates the rows.
  const mode = await githubRepositoryMode();
  if (mode?.mode !== "app" || !mode.slug) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This deployment does not use a GitHub App for personal connections",
    });
  }
  const redirect = encodeURIComponent(githubAppCallbackUrl());
  return {
    status: "pending",
    integration: "github",
    authorizeUrl: `https://github.com/apps/${mode.slug}/installations/new?redirect_uri=${redirect}`,
  };
}

export async function removeConnection(userId: string, id: string): Promise<void> {
  if (parseSharedConnectionId(id)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Shared connections are managed by an admin",
    });
  }
  const connection = await getConnection(userId, id);
  if (!connection) throw new TRPCError({ code: "NOT_FOUND", message: "Connection not found" });

  if (connection.integration === "google") {
    await db
      .delete(googleCloudIntegration)
      .where(and(eq(googleCloudIntegration.id, id), eq(googleCloudIntegration.userId, userId)));
    return;
  }

  // GitHub App installations are removed on GitHub's side; the webhook cleans up our rows.
  const details = connection.details as GitHubConnectionDetails;
  if (details.installationId) {
    await (await getGitHubAppService()).requestUninstallFromGitHub(details.installationId);
  }
}

/** Catalog restricted to what users may actually attach; planned integrations are omitted. */
export async function userIntegrationCatalog() {
  return (await integrationCatalog())
    .filter((integration) => integration.enabled)
    .map(({ key, name, category, allowPersonal, allowShared }) => ({
      key,
      name,
      category,
      allowPersonal,
      allowShared,
    }));
}
