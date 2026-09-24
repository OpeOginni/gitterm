import { createPrivateKey, createPublicKey, randomUUID, type JsonWebKey } from "node:crypto";
import jwt from "jsonwebtoken";
import env from "@gitterm/env/server";
import { db, eq } from "@gitterm/db";
import { googleIssuerConfig } from "@gitterm/db/schema/integrations";
import { EncryptionService } from "../encryption";

export const GOOGLE_SUBJECT_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:jwt";
export const GOOGLE_TOKEN_URL = "https://sts.googleapis.com/v1/token";
export const GOOGLE_ADC_PATH = "/run/gitterm/google/application-default-credentials.json";
const TOKEN_LIFETIME_SECONDS = 5 * 60;

export interface GoogleWorkloadIdentityIntegrationConfig {
  id: string;
  projectId: string;
  workloadIdentityProvider: string;
  serviceAccountEmail: string;
}

export interface WorkloadIdentitySignerConfig {
  issuer: string;
  privateKey: string;
  keyId: string;
}

function normalizePrivateKey(value: string): string {
  return value.includes("\\n") ? value.replaceAll("\\n", "\n") : value;
}

function legacyWorkloadIdentitySignerConfig(): WorkloadIdentitySignerConfig {
  const issuer = env.WORKLOAD_IDENTITY_ISSUER?.replace(/\/$/, "");
  const privateKey = env.WORKLOAD_IDENTITY_PRIVATE_KEY;
  if (!issuer || !privateKey) {
    throw new Error(
      "Google Workload Identity Federation is unavailable; configure WORKLOAD_IDENTITY_ISSUER and WORKLOAD_IDENTITY_PRIVATE_KEY",
    );
  }
  if (!issuer.startsWith("https://") && env.NODE_ENV === "production") {
    throw new Error("WORKLOAD_IDENTITY_ISSUER must use HTTPS in production");
  }
  const normalizedPrivateKey = normalizePrivateKey(privateKey);
  createPrivateKey(normalizedPrivateKey);
  return {
    issuer,
    privateKey: normalizedPrivateKey,
    keyId: env.WORKLOAD_IDENTITY_KEY_ID,
  };
}

export async function workloadIdentitySignerConfig(): Promise<WorkloadIdentitySignerConfig> {
  const [stored] = await db
    .select()
    .from(googleIssuerConfig)
    .where(eq(googleIssuerConfig.id, "google"));
  if (stored) {
    return {
      issuer: stored.issuer,
      keyId: stored.keyId,
      privateKey: new EncryptionService().decrypt(stored.encryptedPrivateKey, "google:issuer:key"),
    };
  }
  // Existing installations keep working until an admin moves their key into the app.
  return legacyWorkloadIdentitySignerConfig();
}

/** Whether this deployment can issue Google workload identity assertions. */
export async function isWorkloadIdentityAvailable(): Promise<boolean> {
  try {
    await workloadIdentitySignerConfig();
    return true;
  } catch {
    return false;
  }
}

export async function workloadIdentityIssuer(): Promise<string> {
  return (await workloadIdentitySignerConfig()).issuer;
}

export function googleAudience(provider: string): string {
  return `//iam.googleapis.com/${provider.replace(/^\/{0,2}iam\.googleapis\.com\//, "")}`;
}

export function issueGoogleSubjectToken(
  claims: { workspaceId: string; userId: string; integrationId: string },
  integration: GoogleWorkloadIdentityIntegrationConfig,
  signer: WorkloadIdentitySignerConfig,
): string {
  return jwt.sign(
    {
      workspace_id: claims.workspaceId,
      user_id: claims.userId,
      integration_id: claims.integrationId,
      project_id: integration.projectId,
    },
    signer.privateKey,
    {
      algorithm: "RS256",
      issuer: signer.issuer,
      audience: googleAudience(integration.workloadIdentityProvider),
      subject: `workspace:${claims.workspaceId}`,
      keyid: signer.keyId,
      jwtid: randomUUID(),
      expiresIn: TOKEN_LIFETIME_SECONDS,
    },
  );
}

export function workloadIdentityJwks(signer: WorkloadIdentitySignerConfig): {
  keys: JsonWebKey[];
} {
  const privateKey = createPrivateKey(signer.privateKey);
  const publicJwk = createPublicKey(privateKey).export({ format: "jwk" });
  return { keys: [{ ...publicJwk, alg: "RS256", use: "sig", kid: signer.keyId }] };
}

export function workloadIdentityDiscovery(signer: WorkloadIdentitySignerConfig) {
  return {
    issuer: signer.issuer,
    jwks_uri: `${signer.issuer}/jwks`,
    response_types_supported: ["id_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
  };
}

export function buildGoogleExternalAccountConfig(input: {
  integration: GoogleWorkloadIdentityIntegrationConfig;
  subjectTokenUrl: string;
  workspaceAgentAuthToken: string;
}) {
  return {
    type: "external_account",
    audience: googleAudience(input.integration.workloadIdentityProvider),
    subject_token_type: GOOGLE_SUBJECT_TOKEN_TYPE,
    token_url: GOOGLE_TOKEN_URL,
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(input.integration.serviceAccountEmail)}:generateAccessToken`,
    credential_source: {
      url: input.subjectTokenUrl,
      headers: { Authorization: `Bearer ${input.workspaceAgentAuthToken}` },
      format: { type: "json", subject_token_field_name: "subject_token" },
    },
  };
}

export function googlePrincipalSet(integration: GoogleWorkloadIdentityIntegrationConfig): string {
  const pool = integration.workloadIdentityProvider.replace(/\/providers\/[^/]+$/, "");
  return `principalSet://iam.googleapis.com/${pool}/attribute.integration_id/${integration.id}`;
}
