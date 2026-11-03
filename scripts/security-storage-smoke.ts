import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

// Always creates its own database. Never uses the caller's DATABASE_URL.
const root = fileURLToPath(new URL("..", import.meta.url));
const container = `gitterm-security-smoke-${randomUUID()}`;
const key = "12".repeat(32);
const nextKey = "34".repeat(32);
let database: { $client: { end(): Promise<void> } } | undefined;
let containerStarted = false;

async function command(args: string[], env?: Record<string, string | undefined>, cwd = root) {
  const child = Bun.spawn(args, { cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  assert.equal(code, 0, `${args[0]} failed: ${stdout}\n${stderr}`);
  return stdout.trim();
}

try {
  await command([
    "docker",
    "run",
    "--detach",
    "--rm",
    "--name",
    container,
    "-e",
    "POSTGRES_PASSWORD=smoke-only",
    "-e",
    "POSTGRES_DB=security_smoke",
    "-p",
    "127.0.0.1::5432",
    "postgres:18",
  ]);
  containerStarted = true;
  const address = await command(["docker", "port", container, "5432/tcp"]);
  const url = `postgresql://postgres:smoke-only@${address}/security_smoke`;
  for (let attempt = 0; ; attempt++) {
    const ready = Bun.spawn(["docker", "exec", container, "pg_isready", "-U", "postgres"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    if ((await ready.exited) === 0) break;
    assert(attempt < 60, "Temporary Postgres did not start");
    await Bun.sleep(250);
  }
  const env = {
    ...process.env,
    NODE_ENV: "test",
    DEPLOYMENT_MODE: "self-hosted",
    DATABASE_URL: url,
    ENCRYPTION_MASTER_KEY: key,
    ENCRYPTION_MASTER_KEY_ID: "primary",
    ENCRYPTION_MASTER_KEYS: "",
    ENCRYPTION_WRITE_VERSION: "v2",
    AUTH_ENCRYPT_OAUTH_TOKENS: "false",
    BETTER_AUTH_SECRET: "synthetic-auth-secret-for-security-smoke-only",
    BETTER_AUTH_SECRETS: "",
    AUTH_SECRET: "",
    BASE_DOMAIN: "localhost:8888",
    BETTER_AUTH_URL: "http://localhost:8888",
    CORS_ORIGIN: "http://localhost:8888",
    REDIS_URL: "",
    POSTHOG_ERROR_TRACKING_ENABLED: "false",
  };
  Object.assign(process.env, env);
  await command(["bun", "run", "db:push", "--force"], env, `${root}/packages/db`);

  const { db } = await import("../packages/db/src/index");
  database = db;
  const { account, session } = await import("../packages/db/src/schema/auth");
  const { agentType, cloudProvider, image } = await import("../packages/db/src/schema/cloud");
  const { modelProvider, userModelCredential } =
    await import("../packages/db/src/schema/model-credentials");
  const { providerType } = await import("../packages/db/src/schema/provider-config");
  const { workspace, workspaceEnvironmentVariables } =
    await import("../packages/db/src/schema/workspace");
  const { workspaceRuntimeBundle } = await import("../packages/db/src/schema/credential-security");
  const { githubRepositoryConfig, googleIssuerConfig } =
    await import("../packages/db/src/schema/integrations");
  const { mcpConnection } = await import("../packages/db/src/schema/mcp");
  const { workspaceRouteAccess } = await import("../packages/db/src/schema/workspace-route-access");
  const { getEncryptionService } = await import("../packages/api/src/service/encryption");
  const { getModelCredentialsService } =
    await import("../packages/api/src/service/credentials/model-credentials");
  const { getProviderConfigService } =
    await import("../packages/api/src/service/config/provider-config");
  const { auth } = await import("../packages/auth/src/index");
  const password = "synthetic-password-for-security-smoke";
  const signUp = await auth.api.signUpEmail({
    body: { email: "security@example.test", name: "Security smoke", password },
  });
  const userId = signUp.user.id;
  const login = () =>
    auth.api.signInEmail({ body: { email: "security@example.test", password }, asResponse: true });
  const response = await login();
  assert.equal(response.status, 200);
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const sessionBefore = await auth.api.getSession({ headers: new Headers({ cookie }) });
  assert.equal(sessionBefore?.user.id, userId);
  const sessionsBefore = await db.select().from(session);

  const [agent] = await db
    .insert(agentType)
    .values({ key: "security-smoke", name: "Security smoke" })
    .returning();
  const [cloud] = await db.insert(cloudProvider).values({ name: "security-smoke" }).returning();
  const [img] = await db
    .insert(image)
    .values({ name: "security-smoke", imageId: "synthetic", agentTypeId: agent!.id })
    .returning();
  await db.insert(modelProvider).values({
    name: "openai",
    displayName: "OpenAI",
    logicalProviderKey: "openai",
    authType: "api_key",
  });
  await db.insert(modelProvider).values({
    name: "openai-oauth",
    displayName: "ChatGPT",
    logicalProviderKey: "openai",
    authType: "oauth",
    plugin: "oauth",
  });
  const service = getModelCredentialsService();
  const saved = await service.storeApiKey({
    userId,
    providerName: "openai",
    apiKey: "synthetic-model-key",
    label: "work",
  });
  const savedOAuth = await service.storeOAuthTokens({
    userId,
    providerName: "openai-oauth",
    refreshToken: "synthetic-refresh",
    accessToken: "synthetic-access",
    expiresAt: Date.now() + 86400000,
    label: "subscription",
  });
  const [kind] = await db
    .insert(providerType)
    .values({ name: "e2b", displayName: "E2B", category: "sandbox", configSchema: {} })
    .returning();
  const compute = await getProviderConfigService().createProviderConfig({
    providerTypeId: kind!.id,
    name: "smoke",
    config: { apiKey: "synthetic-compute-key", webhookSecret: "synthetic-webhook-secret" },
  });
  const encryption = getEncryptionService();
  const [ws] = await db
    .insert(workspace)
    .values({
      userId,
      imageId: img!.id,
      cloudProviderId: cloud!.id,
      externalInstanceId: "synthetic",
      domain: "synthetic",
      status: "running",
      startedAt: new Date(),
      updatedAt: new Date(),
      serverPassword: encryption.encrypt("synthetic-workspace-password"),
      sshConnection: {
        transportKind: "direct-ssh",
        host: "synthetic",
        port: 22,
        revocationToken: encryption.encrypt("synthetic-ssh-token"),
      },
    })
    .returning();
  await db.insert(workspaceRouteAccess).values({
    workspaceId: ws!.id,
    port: null,
    encryptedHeaders: encryption.encrypt(
      JSON.stringify({ Authorization: "synthetic-route-token" }),
    ),
  });
  await db.insert(workspaceRuntimeBundle).values({
    workspaceId: ws!.id,
    encryptedPayload: encryption.encrypt("synthetic-bundle", `gitterm:workspace-runtime:${ws!.id}`),
  });
  await db.insert(workspaceEnvironmentVariables).values({
    userId,
    agentTypeId: agent!.id,
    environmentVariables: {
      version: 1,
      ciphertext: encryption.encrypt(
        JSON.stringify({ API_TOKEN: "synthetic-environment-key" }),
        "gitterm:workspace-environment",
      ),
    },
  });
  await db.insert(googleIssuerConfig).values({
    id: "google",
    issuer: "https://example.test",
    keyId: "synthetic",
    encryptedPrivateKey: encryption.encrypt("synthetic-google-key", "google:issuer:key"),
  });
  await db.insert(githubRepositoryConfig).values({
    id: "github",
    mode: "app",
    encryptedPrivateKey: encryption.encrypt("synthetic-github-key", "github:app:key"),
    encryptedWebhookSecret: encryption.encrypt("synthetic-webhook", "github:app:webhook"),
    encryptedPat: encryption.encrypt("synthetic-pat", "github:global:pat"),
  });
  const mcpId = randomUUID();
  await db.insert(mcpConnection).values({
    id: mcpId,
    userId,
    integration: "mcp",
    authType: "none",
    name: "smoke",
    url: "https://example.test/mcp",
    encryptedAuth: encryption.encrypt(
      JSON.stringify({ type: "none" }),
      `gitterm:mcp:${mcpId}:auth`,
    ),
  });
  const { setTokenUtil } = await import(
    Bun.resolveSync("better-auth/oauth2", `${root}/packages/auth/src`)
  );
  const authContext = await auth.$context;
  const loginAccount = await authContext.internalAdapter.createAccount({
    userId,
    accountId: "synthetic-github",
    providerId: "github",
    accessToken: await setTokenUtil("gho_synthetic_login_token", authContext),
    refreshToken: await setTokenUtil("ghr_synthetic_login_refresh", authContext),
  });
  assert.equal(loginAccount.accessToken, "gho_synthetic_login_token");
  await authContext.internalAdapter.updateAccount(loginAccount.id, {
    accessToken: await setTokenUtil("gho_synthetic_login_token", authContext),
  });
  assert.equal(
    (await db.select().from(account)).find((row) => row.id === loginAccount.id)!.accessToken,
    "gho_synthetic_login_token",
  );

  const migrationEnv = {
    ...env,
    ENCRYPTION_MASTER_KEY: nextKey,
    ENCRYPTION_MASTER_KEY_ID: "next",
    ENCRYPTION_MASTER_KEYS: JSON.stringify({ primary: key }),
    ENCRYPTION_WRITE_VERSION: "v3",
    AUTH_ENCRYPT_OAUTH_TOKENS: "true",
  };
  const migrate = async (script: string, apply = false) => {
    const output = await command(
      ["bun", "run", script, ...(apply ? ["--apply"] : [])],
      migrationEnv,
    );
    return JSON.parse(output.split("\n").findLast((line) => line.startsWith("{"))!);
  };
  const bundled = process.argv.includes("--bundled");
  const rewrapScript = bundled
    ? "apps/server/dist/scripts/security-rewrap.mjs"
    : "packages/api/src/scripts/rewrap-encryption.ts";
  const oauthScript = bundled
    ? "apps/server/dist/scripts/security-oauth.mjs"
    : "packages/auth/src/scripts/encrypt-oauth-tokens.ts";
  const before = await db.select().from(userModelCredential);
  const dry = await migrate(rewrapScript);
  assert.equal(dry.candidates, 13);
  assert.deepEqual(await db.select().from(userModelCredential), before);
  // Pause the first row after the table snapshot, then change its second row.
  // The migration must preserve that concurrent write and report a retryable conflict.
  const ordered = before.toSorted((a, b) => a.id.localeCompare(b.id));
  await db.$client.query(`
    CREATE FUNCTION security_smoke_pause() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_advisory_xact_lock(893421); RETURN NEW; END $$;
    CREATE TRIGGER security_smoke_pause BEFORE UPDATE ON user_model_credential
      FOR EACH ROW WHEN (OLD.id = '${ordered[0]!.id}') EXECUTE FUNCTION security_smoke_pause();
  `);
  const lock = await db.$client.connect();
  await lock.query("SELECT pg_advisory_lock(893421)");
  const racing = Bun.spawn(["bun", "run", rewrapScript, "--apply"], {
    cwd: root,
    env: { ...migrationEnv, DATABASE_URL: `${url}?application_name=gitterm-security-migration` },
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    for (let attempt = 0; ; attempt++) {
      const waiting = await db.$client.query(
        "SELECT 1 FROM pg_stat_activity WHERE application_name = 'gitterm-security-migration' AND wait_event = 'advisory'",
      );
      if (waiting.rowCount) break;
      assert(attempt < 100, "Migration did not reach the controlled concurrency check");
      await Bun.sleep(50);
    }
    const concurrent = encryption.encrypt(encryption.decrypt(ordered[1]!.encryptedCredential));
    await db.$client.query(
      "UPDATE user_model_credential SET encrypted_credential = $1 WHERE id = $2",
      [concurrent, ordered[1]!.id],
    );
  } finally {
    await lock.query("SELECT pg_advisory_unlock(893421)");
    lock.release();
  }
  const racingOutput = await new Response(racing.stdout).text();
  const racingError = await new Response(racing.stderr).text();
  assert.equal(await racing.exited, 1, racingError);
  const raced = JSON.parse(racingOutput.split("\n").findLast((line) => line.startsWith("{"))!);
  assert.equal(raced.conflicts, 1);
  assert.equal(raced.updated, 12);
  await db.$client.query(
    "DROP TRIGGER security_smoke_pause ON user_model_credential; DROP FUNCTION security_smoke_pause()",
  );
  const applied = await migrate(rewrapScript, true);
  assert.equal(applied.updated, 1);
  assert.equal(applied.conflicts, 0);
  assert.equal((await migrate(rewrapScript)).candidates, 0);
  assert.equal((await migrate(rewrapScript, true)).updated, 0);
  const oauthDry = await migrate(oauthScript);
  assert.equal(oauthDry.candidates, 2);
  assert.equal((await migrate(oauthScript, true)).updated, 2);
  assert.equal((await migrate(oauthScript, true)).updated, 0);

  // The pre-activation process can read new records once the overlapping keyring is configured.
  // Restarting with only the new key also proves migration coverage and old-key retirement.
  const verify = `
    import assert from "node:assert/strict";
    import { db } from "./packages/db/src/index";
    import { getModelCredentialsService } from "./packages/api/src/service/credentials/model-credentials";
    import { getProviderConfigService } from "./packages/api/src/service/config/provider-config";
    import { getFreshModelOAuthCredential } from "./packages/api/src/service/credentials/workspace-model-token";
    import { getWorkspaceRouteAccess } from "./packages/api/src/service/workspace-route-access";
    import { openWorkspaceEnvironment, maskWorkspaceEnvironment } from "./packages/api/src/service/workspace-environment-secrets";
    import { decryptWorkspacePassword } from "./packages/api/src/utils/workspace-password";
    import { getEncryptionService, encryptionContext } from "./packages/api/src/service/encryption";
    import { auth } from "./packages/auth/src/index";
    const credential = await getModelCredentialsService().getCredential(${JSON.stringify(saved.id)}, ${JSON.stringify(userId)});
    assert.equal(credential.credential.apiKey, "synthetic-model-key");
    assert.equal((await getProviderConfigService().getProviderConfigById(${JSON.stringify(compute.id)})).config.apiKey, "synthetic-compute-key");
    assert.equal((await getFreshModelOAuthCredential({ userId: ${JSON.stringify(userId)}, credentialId: ${JSON.stringify(savedOAuth.id)} })).access, "synthetic-access");
    const row = (await db.query.workspace.findMany())[0];
    assert.equal(decryptWorkspacePassword(row.serverPassword, row), "synthetic-workspace-password");
    assert.equal(getEncryptionService().decryptForRecord(row.sshConnection.revocationToken, encryptionContext("daytona-ssh", row.id)), "synthetic-ssh-token");
    assert.equal((await getWorkspaceRouteAccess(row.id)).Authorization, "synthetic-route-token");
    const environment = (await db.query.workspaceEnvironmentVariables.findMany())[0];
    assert.equal(openWorkspaceEnvironment(environment.environmentVariables, environment).API_TOKEN, "synthetic-environment-key");
    assert.equal(maskWorkspaceEnvironment(environment.environmentVariables, environment).API_TOKEN, "[REDACTED]");
    assert.equal((await auth.api.getSession({ headers: new Headers({ cookie: ${JSON.stringify(cookie)} }) })).user.id, ${JSON.stringify(userId)});
    const { decryptOAuthToken } = await import(Bun.resolveSync("better-auth/oauth2", ${JSON.stringify(`${root}/packages/auth/src`)}));
    const context = await auth.\u0024context;
    const login = (await db.query.account.findMany()).find(row => row.providerId === "github");
    assert.notEqual(login.accessToken, "gho_synthetic_login_token");
    assert.equal(await decryptOAuthToken(login.accessToken, context), "gho_synthetic_login_token");
    const { setTokenUtil } = await import(Bun.resolveSync("better-auth/oauth2", ${JSON.stringify(`${root}/packages/auth/src`)}));
    await context.internalAdapter.updateAccount(login.id, { accessToken: await setTokenUtil("gho_synthetic_login_token", context) });
    const rewritten = (await db.query.account.findMany()).find(row => row.id === login.id).accessToken;
    assert.equal(rewritten === "gho_synthetic_login_token", process.env.AUTH_ENCRYPT_OAUTH_TOKENS === "false");
    for (const row of await db.query.googleIssuerConfig.findMany()) getEncryptionService().decrypt(row.encryptedPrivateKey, "google:issuer:key");
    for (const row of await db.query.githubRepositoryConfig.findMany()) {
      getEncryptionService().decrypt(row.encryptedPrivateKey, "github:app:key");
      getEncryptionService().decrypt(row.encryptedWebhookSecret, "github:app:webhook");
      getEncryptionService().decrypt(row.encryptedPat, "github:global:pat");
    }
    for (const row of await db.query.mcpConnection.findMany()) getEncryptionService().decrypt(row.encryptedAuth, "gitterm:mcp:" + row.id + ":auth");
    for (const row of await db.query.workspaceRuntimeBundle.findMany()) getEncryptionService().decrypt(row.encryptedPayload, "gitterm:workspace-runtime:" + row.workspaceId);
    const { Hono } = await import(Bun.resolveSync("hono", ${JSON.stringify(`${root}/packages/api/src`)}));
    const { workspaceRouter } = await import("./packages/api/src/routers/workspace/managment");
    const { createContext } = await import("./packages/api/src/context");
    const app = new Hono();
    app.get("/check", async c => {
      const caller = workspaceRouter.createCaller(await createContext({ context: c }));
      const single = await caller.getEnvironmentVariables({ agentTypeId: environment.agentTypeId });
      const list = await caller.listEnvironmentVariables();
      const credential = await caller.getAccessCredential({ workspaceId: row.id });
      assert.equal(single.environmentVariables.environmentVariables.API_TOKEN, "[REDACTED]");
      assert.equal(list.environmentVariables[0].environmentVariables.API_TOKEN, "[REDACTED]");
      assert.equal(credential.credential, "synthetic-workspace-password");
      return c.text("ok");
    });
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: app.fetch });
    try {
      const result = await fetch(new URL("/check", server.url), { headers: { cookie: ${JSON.stringify(cookie)} } });
      assert.equal(await result.text(), "ok");
      assert.equal(result.status, 200);
    } finally { server.stop(true); }
    await db.\u0024client.end();
  `;
  await command(["bun", "--eval", verify], {
    ...migrationEnv,
    ENCRYPTION_WRITE_VERSION: "v2",
    AUTH_ENCRYPT_OAUTH_TOKENS: "false",
  });
  assert.equal((await migrate(oauthScript, true)).updated, 1);
  await command(["bun", "--eval", verify], { ...migrationEnv, ENCRYPTION_MASTER_KEYS: "" });
  assert.deepEqual(await db.select().from(session), sessionsBefore);
  assert.equal((await login()).status, 200);
  console.log(
    "PASS: 13 secret values migrated across all storage paths; dry run and reruns are safe.",
  );
  console.log(
    "PASS: a concurrent credential update is preserved, reported as a conflict, and migrated on retry.",
  );
  console.log(
    "PASS: API keys, OAuth refresh, workspace passwords, environment masking, SSH tokens and integration keys remain readable after old-key removal.",
  );
  console.log(
    "PASS: OAuth login tokens encrypted; existing browser session and password login preserved.",
  );
  console.log(
    "PASS: reader-only deployment reads encrypted tokens; HTTP environment and workspace credential endpoints work with the existing session.",
  );
} finally {
  try {
    await database?.$client.end();
  } finally {
    if (containerStarted) await command(["docker", "stop", container]);
  }
}
