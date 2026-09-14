import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import { describe, expect, test } from "bun:test";
import {
  buildGoogleExternalAccountConfig,
  googleAudience,
  googlePrincipalSet,
  issueGoogleSubjectToken,
  workloadIdentityJwks,
} from "./google";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const signer = {
  issuer: "https://api.example.test/api/workload-identity",
  privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  keyId: "test-key",
};
const integration = {
  id: "integration-id",
  projectId: "example-dev",
  workloadIdentityProvider:
    "projects/123456789/locations/global/workloadIdentityPools/gitterm/providers/gitterm",
  serviceAccountEmail: "agent@example-dev.iam.gserviceaccount.com",
};

describe("Google workload identity", () => {
  test("issues a five-minute repository-independent workspace assertion", () => {
    const token = issueGoogleSubjectToken(
      { workspaceId: "workspace-id", userId: "user-id", integrationId: integration.id },
      integration,
      signer,
    );
    const decoded = jwt.decode(token, { complete: true })!;
    expect(decoded.header).toMatchObject({ alg: "RS256", kid: "test-key" });
    expect(decoded.payload).toMatchObject({
      iss: signer.issuer,
      aud: googleAudience(integration.workloadIdentityProvider),
      sub: "workspace:workspace-id",
      integration_id: integration.id,
    });
    expect((decoded.payload as jwt.JwtPayload).jti).toBeTruthy();
    expect(
      (decoded.payload as jwt.JwtPayload).exp! - (decoded.payload as jwt.JwtPayload).iat!,
    ).toBe(300);
    expect(workloadIdentityJwks(signer).keys[0]).toMatchObject({
      alg: "RS256",
      use: "sig",
      kid: "test-key",
      kty: "RSA",
    });
  });

  test("builds a secretless ADC configuration and integration-specific principal", () => {
    const config = buildGoogleExternalAccountConfig({
      integration,
      subjectTokenUrl: `${signer.issuer}/google/subject-token`,
      workspaceAgentAuthToken: "workspace-token",
    });
    expect(config).toMatchObject({
      type: "external_account",
      audience: `//iam.googleapis.com/${integration.workloadIdentityProvider}`,
      credential_source: {
        headers: { Authorization: "Bearer workspace-token" },
      },
    });
    expect(googlePrincipalSet(integration)).toBe(
      "principalSet://iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/gitterm/attribute.integration_id/integration-id",
    );
  });
});
