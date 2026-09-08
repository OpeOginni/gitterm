import {
  CreateSecretCommand,
  DeleteSecretCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import type { AwsConfig } from "./types";
import { withAwsRequestDeadline } from "./request-deadline";

export function runtimeSecretClient(config: AwsConfig) {
  return withAwsRequestDeadline(
    new SecretsManagerClient({
      region: config.defaultRegion,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }),
  );
}

export async function createRuntimeSecret(
  config: AwsConfig,
  workspaceId: string,
  environment: Record<string, string | undefined>,
  providerId?: string,
) {
  const values = Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  if (Object.keys(values).some((key) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)))
    throw new Error("Invalid workspace environment variable name");
  if (Buffer.byteLength(JSON.stringify(values), "utf8") > 65536)
    throw new Error(
      "Workspace environment exceeds the 64 KiB runtime secret limit; reduce inline agent files or environment values",
    );
  const result = await runtimeSecretClient(config).send(
    new CreateSecretCommand({
      Name: `gitterm/workspaces/${workspaceId}`,
      SecretString: JSON.stringify(values),
      Tags: [
        { Key: "ManagedBy", Value: "gitterm" },
        { Key: "WorkspaceId", Value: workspaceId },
        { Key: "CreatedAt", Value: new Date().toISOString() },
        ...(providerId ? [{ Key: "ProviderId", Value: providerId }] : []),
      ],
    }),
  );
  if (!result.ARN) throw new Error("AWS did not return a runtime secret ARN");
  return {
    arn: result.ARN,
    secrets: Object.keys(values).map((name) => ({ name, valueFrom: `${result.ARN}:${name}::` })),
  };
}

export async function deleteRuntimeSecret(config: AwsConfig, arn: string) {
  try {
    await runtimeSecretClient(config).send(
      new DeleteSecretCommand({ SecretId: arn, RecoveryWindowInDays: 7 }),
    );
  } catch (error) {
    if ((error as { name?: string }).name !== "ResourceNotFoundException") throw error;
  }
}
