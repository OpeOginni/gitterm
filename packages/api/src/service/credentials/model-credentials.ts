/**
 * Model Credentials Service
 *
 * Handles CRUD operations for user model credentials with encryption.
 * Supports both API key and OAuth credential types.
 */

import { db, eq, and } from "@gitterm/db";
import {
  modelProvider,
  model,
  userModelCredential,
  modelCredentialAudit,
  type ModelProvider,
  type Model,
} from "@gitterm/db/schema/model-credentials";
import {
  getEncryptionService,
  type ApiKeyCredential,
  type OAuthCredential,
  EncryptionService,
} from "../encryption";
import { GitHubCopilotOAuthService } from "./oauth/github-copilot";
import { OpenAICodexOAuthService } from "./oauth/openai-codex";

// Types for credential operations
export interface StoreApiKeyOptions {
  userId: string;
  providerName: string;
  apiKey: string;
  label?: string;
}

export interface StoreOAuthOptions {
  userId: string;
  providerName: string;
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number;
  enterpriseUrl?: string;
  label?: string;
}

export interface CredentialMetadata {
  id: string;
  providerId: string;
  providerName: string;
  providerDisplayName: string;
  authType: string;
  label: string | null;
  keyHash: string;
  isActive: boolean;
  lastUsedAt: Date | null;
  oauthExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DecryptedCredential {
  id: string;
  providerId: string;
  providerName: string;
  authType: string;
  credential: ApiKeyCredential | OAuthCredential;
  plugin: string | null;
}

export type CredentialForRun =
  | {
      type: "api_key";
      apiKey: string;
    }
  | {
      type: "oauth";
      providerName: string;
      refresh: string;
      access: string;
      expires: number;
    };

/**
 * Model Credentials Service
 */
export class ModelCredentialsService {
  private encryption: EncryptionService;

  constructor() {
    this.encryption = getEncryptionService();
  }

  // ==================== Provider Operations ====================

  /**
   * Get all enabled model providers
   */
  async listProviders(): Promise<ModelProvider[]> {
    return db.query.modelProvider.findMany({
      where: eq(modelProvider.isEnabled, true),
      orderBy: (t, { asc }) => [asc(t.displayName)],
    });
  }

  /**
   * Get a provider by name
   */
  async getProviderByName(name: string): Promise<ModelProvider | undefined> {
    return db.query.modelProvider.findFirst({
      where: eq(modelProvider.name, name),
    });
  }

  /**
   * Get a provider by ID
   */
  async getProviderById(id: string): Promise<ModelProvider | undefined> {
    return db.query.modelProvider.findFirst({
      where: eq(modelProvider.id, id),
    });
  }

  // ==================== Model Operations ====================

  /**
   * Get all enabled models for a provider
   */
  async listModelsForProvider(providerId: string): Promise<Model[]> {
    return db.query.model.findMany({
      where: and(eq(model.providerId, providerId), eq(model.isEnabled, true)),
      orderBy: (t, { asc }) => [asc(t.displayName)],
    });
  }

  /**
   * Get all enabled models with their providers
   */
  async listAllModels(): Promise<(Model & { provider: ModelProvider })[]> {
    const models = await db.query.model.findMany({
      where: eq(model.isEnabled, true),
      with: {
        provider: true,
      },
      orderBy: (t, { asc }) => [asc(t.displayName)],
    });

    return models.filter((m) => m.provider.isEnabled);
  }

  /**
   * Get a model by ID
   */
  async getModelById(id: string): Promise<Model | undefined> {
    return db.query.model.findFirst({
      where: eq(model.id, id),
    });
  }

  // ==================== Credential CRUD Operations ====================

  /**
   * Store an API key credential
   */
  async storeApiKey(options: StoreApiKeyOptions): Promise<{ id: string; keyHash: string }> {
    const { userId, providerName, apiKey, label } = options;

    // Get the provider
    const provider = await this.getProviderByName(providerName);
    if (!provider) {
      throw new Error(`Provider not found: ${providerName}`);
    }

    if (provider.authType !== "api_key") {
      throw new Error(`Provider ${providerName} does not support API key authentication`);
    }

    // Create credential object
    const credential: ApiKeyCredential = {
      type: "api_key",
      apiKey,
    };

    // Encrypt and hash
    const encryptedCredential = this.encryption.encryptCredential(credential);
    const keyHash = this.encryption.hashForAudit(apiKey);

    // Store in database
    const results = await db
      .insert(userModelCredential)
      .values({
        userId,
        providerId: provider.id,
        encryptedCredential,
        keyHash,
        label: label || null,
      })
      .returning({ id: userModelCredential.id });

    const result = results[0];
    if (!result) {
      throw new Error("Failed to store credential");
    }

    // Log audit event
    await this.logAudit(result.id, userId, "created", keyHash);

    return { id: result.id, keyHash };
  }

  /**
   * Store OAuth tokens (refresh token + optional access token)
   */
  async storeOAuthTokens(options: StoreOAuthOptions): Promise<{ id: string; keyHash: string }> {
    const { userId, providerName, refreshToken, accessToken, expiresAt, enterpriseUrl, label } =
      options;

    // Get the provider
    const provider = await this.getProviderByName(providerName);
    if (!provider) {
      throw new Error(`Provider not found: ${providerName}`);
    }

    if (provider.authType !== "oauth") {
      throw new Error(`Provider ${providerName} does not support OAuth authentication`);
    }

    // Create credential object
    const credential: OAuthCredential = {
      type: "oauth",
      refresh: refreshToken,
      access: accessToken,
      expires: expiresAt,
      enterpriseUrl,
    };

    // Encrypt and hash (hash the refresh token for audit)
    const encryptedCredential = this.encryption.encryptCredential(credential);
    const keyHash = this.encryption.hashForAudit(refreshToken);

    // Calculate OAuth expiry timestamp
    const oauthExpiresAt = expiresAt ? new Date(expiresAt) : null;

    // Store in database
    const results = await db
      .insert(userModelCredential)
      .values({
        userId,
        providerId: provider.id,
        encryptedCredential,
        keyHash,
        oauthExpiresAt,
        label: label || null,
      })
      .returning({ id: userModelCredential.id });

    const result = results[0];
    if (!result) {
      throw new Error("Failed to store credential");
    }

    // Log audit event
    await this.logAudit(result.id, userId, "created", keyHash);

    return { id: result.id, keyHash };
  }

  /**
   * List all credentials for a user (metadata only, no secrets)
   */
  async listUserCredentials(userId: string): Promise<CredentialMetadata[]> {
    const credentials = await db.query.userModelCredential.findMany({
      where: eq(userModelCredential.userId, userId),
      with: {
        provider: true,
      },
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });

    return credentials.map((cred) => ({
      id: cred.id,
      providerId: cred.providerId,
      providerName: cred.provider.name,
      providerDisplayName: cred.provider.displayName,
      authType: cred.provider.authType,
      label: cred.label,
      keyHash: cred.keyHash,
      isActive: cred.isActive,
      lastUsedAt: cred.lastUsedAt,
      oauthExpiresAt: cred.oauthExpiresAt,
      createdAt: cred.createdAt,
      updatedAt: cred.updatedAt,
    }));
  }

  /**
   * Get a credential by ID (with decryption)
   */
  async getCredential(credentialId: string, userId: string): Promise<DecryptedCredential | null> {
    const cred = await db.query.userModelCredential.findFirst({
      where: and(eq(userModelCredential.id, credentialId), eq(userModelCredential.userId, userId)),
      with: {
        provider: true,
      },
    });

    if (!cred) {
      return null;
    }

    const credential = this.encryption.decryptCredential(cred.encryptedCredential);

    return {
      id: cred.id,
      providerId: cred.providerId,
      providerName: cred.provider.name,
      authType: cred.provider.authType,
      credential,
      plugin: cred.provider.plugin,
    };
  }

  /**
   * Get a user's credential for a specific provider
   */
  async getUserCredentialForProvider(
    userId: string,
    providerName: string,
  ): Promise<DecryptedCredential | null> {
    const provider = await this.getProviderByName(providerName);
    if (!provider) {
      return null;
    }

    const cred = await db.query.userModelCredential.findFirst({
      where: and(
        eq(userModelCredential.userId, userId),
        eq(userModelCredential.providerId, provider.id),
        eq(userModelCredential.isActive, true),
      ),
      with: {
        provider: true,
      },
    });

    if (!cred) {
      return null;
    }

    const credential = this.encryption.decryptCredential(cred.encryptedCredential);

    return {
      id: cred.id,
      providerId: cred.providerId,
      providerName: cred.provider.name,
      authType: cred.provider.authType,
      credential,
      plugin: cred.provider.plugin,
    };
  }

  /**
   * Revoke (soft delete) a credential
   */
  async revokeCredential(credentialId: string, userId: string): Promise<void> {
    const cred = await db.query.userModelCredential.findFirst({
      where: and(eq(userModelCredential.id, credentialId), eq(userModelCredential.userId, userId)),
    });

    if (!cred) {
      throw new Error("Credential not found");
    }

    await db
      .update(userModelCredential)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(userModelCredential.id, credentialId));

    await this.logAudit(credentialId, userId, "revoked", cred.keyHash);
  }

  /**
   * Permanently delete a credential
   */
  async deleteCredential(credentialId: string, userId: string): Promise<void> {
    const cred = await db.query.userModelCredential.findFirst({
      where: and(eq(userModelCredential.id, credentialId), eq(userModelCredential.userId, userId)),
    });

    if (!cred) {
      throw new Error("Credential not found");
    }

    // Log before deletion (since credential_id will be set to null)
    await this.logAudit(null, userId, "deleted", cred.keyHash);

    await db.delete(userModelCredential).where(eq(userModelCredential.id, credentialId));
  }

  /**
   * Rotate an API key
   */
  async rotateApiKey(credentialId: string, userId: string, newApiKey: string): Promise<void> {
    const cred = await db.query.userModelCredential.findFirst({
      where: and(eq(userModelCredential.id, credentialId), eq(userModelCredential.userId, userId)),
      with: { provider: true },
    });

    if (!cred) {
      throw new Error("Credential not found");
    }

    if (cred.provider.authType !== "api_key") {
      throw new Error("Can only rotate API key credentials");
    }

    const credential: ApiKeyCredential = {
      type: "api_key",
      apiKey: newApiKey,
    };

    const encryptedCredential = this.encryption.encryptCredential(credential);
    const keyHash = this.encryption.hashForAudit(newApiKey);

    await db
      .update(userModelCredential)
      .set({
        encryptedCredential,
        keyHash,
        updatedAt: new Date(),
      })
      .where(eq(userModelCredential.id, credentialId));

    await this.logAudit(credentialId, userId, "rotated", keyHash);
  }

  // ==================== OAuth Token Refresh ====================

  /**
   * Refresh OAuth access token if expired
   * Returns the current valid access token
   */
  async refreshOAuthTokenIfNeeded(credentialId: string, userId: string): Promise<string> {
    const decrypted = await this.getCredential(credentialId, userId);

    if (!decrypted) {
      throw new Error("Credential not found");
    }

    if (decrypted.credential.type !== "oauth") {
      throw new Error("Not an OAuth credential");
    }

    const oauthCred = decrypted.credential;

    // Check if we have a valid access token
    const now = Date.now();
    const bufferMs = 5 * 60 * 1000; // 5 minute buffer

    if (oauthCred.access && oauthCred.expires && oauthCred.expires > now + bufferMs) {
      // Token is still valid
      return oauthCred.access;
    }

    // Need to refresh - use the provider's plugin to determine refresh method
    if (decrypted.plugin === "copilot-auth") {
      const newToken = await GitHubCopilotOAuthService.refreshCopilotToken(
        oauthCred.refresh,
        oauthCred.enterpriseUrl,
      );

      // Update stored credential
      const updatedCredential: OAuthCredential = {
        type: "oauth",
        refresh: oauthCred.refresh,
        access: newToken.token,
        expires: newToken.expiresAt * 1000, // Convert to milliseconds
        enterpriseUrl: oauthCred.enterpriseUrl,
      };

      const encryptedCredential = this.encryption.encryptCredential(updatedCredential);

      await db
        .update(userModelCredential)
        .set({
          encryptedCredential,
          oauthExpiresAt: new Date(newToken.expiresAt * 1000),
          updatedAt: new Date(),
        })
        .where(eq(userModelCredential.id, credentialId));

      await this.logAudit(credentialId, userId, "refreshed", decrypted.credential.type);

      return newToken.token;
    }

    if (decrypted.plugin === "codex-auth") {
      const newTokens = await OpenAICodexOAuthService.refreshToken(oauthCred.refresh);

      // Update stored credential - Codex returns new refresh token too
      const updatedCredential: OAuthCredential = {
        type: "oauth",
        refresh: newTokens.refreshToken,
        access: newTokens.accessToken,
        expires: newTokens.expiresAt,
        // Codex stores accountId separately in the credential
        accountId: newTokens.accountId,
      };

      const encryptedCredential = this.encryption.encryptCredential(updatedCredential);

      await db
        .update(userModelCredential)
        .set({
          encryptedCredential,
          oauthExpiresAt: new Date(newTokens.expiresAt),
          updatedAt: new Date(),
        })
        .where(eq(userModelCredential.id, credentialId));

      await this.logAudit(credentialId, userId, "refreshed", decrypted.credential.type);

      return newTokens.accessToken;
    }

    throw new Error(
      `OAuth refresh not supported for provider: ${decrypted.providerName} (plugin: ${decrypted.plugin})`,
    );
  }

  // ==================== Runtime Credential Access ====================

  /**
   * Get credential ready for use in a run.
   * Handles OAuth token refresh automatically.
   * Returns the full credential info needed by the sandbox.
   */
  async getCredentialForRun(
    credentialId: string,
    userId: string,
    context?: { loopId?: string; runId?: string; workspaceId?: string },
  ): Promise<CredentialForRun> {
    const decrypted = await this.getCredential(credentialId, userId);

    if (!decrypted) {
      throw new Error("Credential not found");
    }

    // Update last used
    await db
      .update(userModelCredential)
      .set({ lastUsedAt: new Date() })
      .where(eq(userModelCredential.id, credentialId));

    // Log usage
    await this.logAudit(credentialId, userId, "used", undefined, context);

    if (decrypted.credential.type === "api_key") {
      return {
        type: "api_key",
        apiKey: decrypted.credential.apiKey,
      };
    }

    // OAuth - need to ensure we have a fresh access token
    // Re-fetch the credential after refresh to get updated tokens
    await this.refreshOAuthTokenIfNeeded(credentialId, userId);
    const refreshedCred = await this.getCredential(credentialId, userId);

    if (!refreshedCred || refreshedCred.credential.type !== "oauth") {
      throw new Error("Failed to get refreshed OAuth credential");
    }

    const oauthCred = refreshedCred.credential as OAuthCredential;

    return {
      type: "oauth",
      providerName: decrypted.providerName,
      refresh: oauthCred.refresh,
      access: oauthCred.access || "",
      expires: oauthCred.expires || 0,
    };
  }

  /**
   * Create an encrypted payload for passing to a sandbox.
   */
  async createEncryptedPayloadForSandbox(
    credentialId: string,
    userId: string,
    sessionKey: Buffer,
  ): Promise<string> {
    const credForRun = await this.getCredentialForRun(credentialId, userId);

    if (credForRun.type === "api_key") {
      return this.encryption.encryptForSandbox(
        {
          type: "api_key",
          apiKey: credForRun.apiKey,
        },
        sessionKey,
      );
    }

    // OAuth credential
    return this.encryption.encryptForSandbox(
      {
        type: "oauth",
        refresh: credForRun.refresh,
        access: credForRun.access,
        expires: credForRun.expires,
      } as OAuthCredential,
      sessionKey,
    );
  }

  // ==================== Audit Logging ====================

  private async logAudit(
    credentialId: string | null,
    userId: string,
    action: string,
    keyHash?: string,
    context?: object,
  ): Promise<void> {
    await db.insert(modelCredentialAudit).values({
      credentialId,
      userId,
      action,
      keyHash: keyHash || null,
      context: context || null,
    });
  }
}

// Singleton instance
let modelCredentialsService: ModelCredentialsService | null = null;

export function getModelCredentialsService(): ModelCredentialsService {
  if (!modelCredentialsService) {
    modelCredentialsService = new ModelCredentialsService();
  }
  return modelCredentialsService;
}

export const modelCredentials = {
  getService: getModelCredentialsService,
};
