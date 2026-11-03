import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import { createHash, createHmac, randomUUID } from "node:crypto";
import type { Context } from "../context";

/**
 * Managed sandboxes against a disposable local database, with the E2B transport faked.
 * SANDBOX_DATABASE_TEST_URL must equal DATABASE_URL and point at a throwaway, migrated and
 * seeded database (`db:migrate`, `db:seed`):
 *   DATABASE_URL=$URL SANDBOX_DATABASE_TEST_URL=$URL bun test ...
 * The suite sets the server settings it needs and enables E2B and Boat for its duration.
 */
const testUrl = process.env.SANDBOX_DATABASE_TEST_URL;
if (testUrl && testUrl !== process.env.DATABASE_URL)
  throw new Error("DATABASE_URL must equal the explicit disposable SANDBOX_DATABASE_TEST_URL");
const integration = testUrl ? test : test.skip;

// Read when the server modules load, so they are set before the imports below.
const env = process.env as Record<string, string | undefined>;
env.ENABLE_USAGE_METERING = "true";
env.INTERNAL_API_KEY ||= "sandbox-integration-test";
const { and, db, eq, inArray } = await import("@gitterm/db");
const { user } = await import("@gitterm/db/schema/auth");
const { cloudProvider, machineProfile } = await import("@gitterm/db/schema/cloud");
const { usageSession, workspace, workspaceTermination } =
  await import("@gitterm/db/schema/workspace");
const { UNLIMITED_ENTITLEMENTS } = await import("@gitterm/schema/billing");
const transportModule = await import("../service/sandbox-transport");
const { sandboxRouter } = await import("./sandbox");
const billing = await import("../billing");
const activity = await import("../service/workspace-activity");
const proxyCache = await import("../service/proxy-cache");
const providerConfig = await import("../service/config/provider-config");
const { internalRouter } = await import("./internal");
const { workspaceRouter } = await import("./workspace/managment");
const { proxyResolverRouter } = await import("./proxy");
const { getWorkspacePortUrl } = await import("../utils/routing");
const { Hono } = await import("hono");
const { auth } = await import("@gitterm/auth");
/** Providers this suite enabled, disabled again afterwards. */
let enabledForTest: string[] = [];

const userId = `sandbox-test-${randomUUID()}`;
const otherId = `sandbox-other-${randomUUID()}`;
const caller = (id: string) =>
  sandboxRouter.createCaller({ session: { user: { id } } } as unknown as Context);
const created = new Map<string, Record<string, string>>();
const commands: string[] = [];
const destroyed: string[] = [];
const allowanceChecks: unknown[] = [];
let workspaceLimit = 2;
let machineAccess: "any" | "smallest" = "any";
/** What each create asked the provider for. */
const requested = new Map<string, { template?: string; machine?: Record<string, unknown> }>();
let failDestroys = 0;
/** Provider-side state; destroy marks a sandbox gone unless `acceptOnlyDestroys` is set. */
const providerStates = new Map<string, "running" | "paused" | "terminated">();
let acceptOnlyDestroys = false;
const WEBHOOK_SECRET = "test-webhook-secret";
const mocks: { mockRestore(): void }[] = [];
/** Runs inside the fake provider's resume call. */
let duringResume: ((id: string) => Promise<void>) | undefined;
/** What the fake provider asked for, and the access headers its previews return. */
const providerPublic: boolean[] = [];
let previewHeaders: Record<string, string> = { "e2b-traffic-access-token": "t" };

beforeAll(async () => {
  if (!testUrl) return;
  const fake = {
    provider: "e2b" as const,
    home: "/home/user",
    async create(input: {
      labels: Record<string, string>;
      template?: string;
      machine?: Record<string, unknown>;
      publicPreviews?: boolean;
    }) {
      const id = `fake-${randomUUID()}`;
      providerPublic.push(input.publicPreviews === true);
      created.set(id, { ...input.labels, template: input.template ?? "" });
      requested.set(id, { template: input.template, machine: input.machine });
      return {
        id,
        state: "running" as const,
        labels: input.labels,
        template: "base",
        startedAt: new Date().toISOString(),
        expiresAt: null,
      };
    },
    async run(id: string, command: string) {
      commands.push(`${id}:${command}`);
      return { exitCode: command === "exit 4" ? 4 : 0, stdout: `ran ${command}`, stderr: "" };
    },
    async writeFile() {},
    async readFile() {
      return new Uint8Array([1, 2, 3]);
    },
    async pause() {},
    async resume(id: string) {
      await duringResume?.(id);
    },
    async destroy(id: string) {
      destroyed.push(id);
      if (failDestroys > 0) {
        failDestroys--;
        throw new Error("provider deletion failed");
      }
      // Like Daytona's default delete(): accepted, but the resource still exists for a while.
      if (!acceptOnlyDestroys) providerStates.set(id, "terminated");
    },
    async info(id: string) {
      return {
        id,
        state: providerStates.get(id) ?? "running",
        labels: {},
        startedAt: null,
        expiresAt: null,
      };
    },
    async preview(_id: string, port: number) {
      return { url: `https://${port}-fake.e2b.app`, headers: previewHeaders };
    },
  };
  mocks.push(
    // Like the real lookup, resolving the transport reads provider config from the database.
    spyOn(transportModule, "managedSandboxTransport").mockImplementation(
      async () => (await new Promise((resolve) => setTimeout(resolve, 50)), fake as never),
    ),
    spyOn(billing, "getBilling").mockResolvedValue({
      ...billing.unlimitedBilling,
      enabled: true,
      getEntitlements: async () => ({
        ...UNLIMITED_ENTITLEMENTS,
        maxWorkspaces: workspaceLimit,
        machineAccess,
      }),
      checkRunAllowance: async (id: string, input: unknown) => {
        allowanceChecks.push({ id, input });
        return { allowed: true };
      },
    }),
    spyOn(activity, "recordWorkspaceActivity").mockResolvedValue(),
    spyOn(proxyCache, "invalidateProxyCacheForWorkspace").mockResolvedValue(),
    spyOn(proxyCache, "invalidateAllProxyRouteAccessCache").mockResolvedValue(),
    spyOn(providerConfig, "getProviderConfigService").mockReturnValue({
      getProviderConfigForUse: async () => ({ webhookSecret: WEBHOOK_SECRET }),
    } as never),
  );
  const disabled = await db
    .update(cloudProvider)
    .set({ isEnabled: true })
    .where(
      and(inArray(cloudProvider.providerKey, ["e2b", "boat"]), eq(cloudProvider.isEnabled, false)),
    )
    .returning({ id: cloudProvider.id });
  enabledForTest = disabled.map((row) => row.id);
  await db.insert(user).values(
    [userId, otherId].map((id) => ({
      id,
      name: "Sandbox test",
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  );
});

afterAll(async () => {
  for (const mock of mocks) mock.mockRestore();
  if (!testUrl) return;
  if (enabledForTest.length)
    await db
      .update(cloudProvider)
      .set({ isEnabled: false })
      .where(inArray(cloudProvider.id, enabledForTest));
  const rows = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(inArray(workspace.userId, [userId, otherId]));
  if (rows.length) {
    await db.delete(workspaceTermination).where(
      inArray(
        workspaceTermination.workspaceId,
        rows.map((row) => row.id),
      ),
    );
    await db.delete(workspace).where(
      inArray(
        workspace.id,
        rows.map((row) => row.id),
      ),
    );
  }
  await db.delete(user).where(inArray(user.id, [userId, otherId]));
});

integration(
  "managed sandboxes are billed workspaces with usage sessions and plan limits",
  async () => {
    const sandbox = await caller(userId).create({
      name: "managed",
      lifetimeMinutes: 30,
      metadata: { purpose: "test" },
    });
    expect(sandbox.status).toBe("running");
    expect(sandbox.expiresAt).not.toBeNull();

    const [row] = await db.select().from(workspace).where(eq(workspace.id, sandbox.id));
    expect(row).toMatchObject({ userId, status: "running", serverOnly: true });
    expect(row!.machineProfileId).not.toBeNull();
    // Plan allowance is checked against the machine profile the sandbox is billed at.
    expect(allowanceChecks).toEqual([
      { id: userId, input: { action: "create", machineProfileId: row!.machineProfileId } },
    ]);
    // The provider handle is self-describing and labels identify the workspace and owner.
    expect(sandbox.provider).toBe("e2b");
    expect(row!.externalInstanceId).toStartWith("sandbox:e2b:");
    const providerId = row!.externalInstanceId.slice("sandbox:e2b:".length);
    expect(created.get(providerId)).toMatchObject({
      gitterm_workspace: sandbox.id,
      gitterm_workload: "sandbox",
      gitterm_user: userId,
    });

    const sessions = await db
      .select()
      .from(usageSession)
      .where(eq(usageSession.workspaceId, sandbox.id));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.stoppedAt).toBeNull();

    // Command failure is a result; the provider-side command ran in this sandbox only.
    expect(await caller(userId).run({ sandboxId: sandbox.id, command: "exit 4" })).toMatchObject({
      exitCode: 4,
    });
    expect(commands.at(-1)).toBe(`${providerId}:exit 4`);

    // Another user cannot see or operate it.
    await expect(caller(otherId).get({ sandboxId: sandbox.id })).rejects.toThrow(/not found/i);
    await expect(caller(otherId).run({ sandboxId: sandbox.id, command: "id" })).rejects.toThrow(
      /not found/i,
    );
    await expect(caller(otherId).terminate({ sandboxId: sandbox.id })).rejects.toThrow(
      /not found/i,
    );
    expect(await caller(otherId).list()).toEqual([]);

    await caller(userId).create({ name: "second", lifetimeMinutes: 5 });
    await expect(caller(userId).create({ name: "third", lifetimeMinutes: 5 })).rejects.toThrow(
      /plan limit of 2/,
    );

    await caller(userId).terminate({ sandboxId: sandbox.id });
    // Termination reached the sandbox transport through the provider handle wrapper.
    expect(destroyed).toContain(providerId);
    const [after] = await db.select().from(workspace).where(eq(workspace.id, sandbox.id));
    expect(after!.status).toBe("terminated");
    const closed = await db
      .select()
      .from(usageSession)
      .where(eq(usageSession.workspaceId, sandbox.id));
    expect(closed[0]!.stoppedAt).not.toBeNull();
    expect(closed[0]!.stopSource).toBe("manual");
    await expect(caller(userId).run({ sandboxId: sandbox.id, command: "id" })).rejects.toThrow(
      /terminated/,
    );
  },
);

integration("Gitterm serves managed previews: public to anyone, private to the owner", async () => {
  await terminateAll(userId);
  const resolver = new Hono().get("/resolve", proxyResolverRouter);
  const resolve = (subdomain: string, port: number) =>
    resolver.request("/resolve", {
      headers: {
        "X-Internal-Key": process.env.INTERNAL_API_KEY!,
        "X-Subdomain": `${port}-${subdomain}`,
      },
    });

  providerPublic.length = 0;
  const sandbox = await caller(userId).create({
    name: "previews",
    lifetimeMinutes: 30,
    publicPreviews: true,
  });
  // Gitterm decides who sees previews, so the provider URL itself stays private.
  expect(providerPublic).toEqual([false]);

  const [mine, shared] = await Promise.all([
    caller(userId).preview({ sandboxId: sandbox.id, port: 3000 }),
    caller(userId).preview({ sandboxId: sandbox.id, port: 5173, public: true }),
  ]);
  const [row] = await db.select().from(workspace).where(eq(workspace.id, sandbox.id));
  const subdomain = row!.subdomain!;
  // Concurrent previews share one subdomain and keep each other's ports.
  expect(mine!.gittermUrl).toBe(getWorkspacePortUrl(subdomain, 3000));
  expect(shared!.gittermUrl).toBe(getWorkspacePortUrl(subdomain, 5173));
  expect(row!.exposedPorts).toEqual({
    "3000": { port: 3000, upstreamUrl: "https://3000-fake.e2b.app", visibility: "private" },
    "5173": { port: 5173, upstreamUrl: "https://5173-fake.e2b.app", visibility: "public" },
  });
  // Direct access is still returned, for local proxies.
  expect(mine).toMatchObject({ headers: { "e2b-traffic-access-token": "t" } });

  const open = await resolve(subdomain, 5173);
  expect(open.status).toBe(200);
  expect(open.headers.get("X-Upstream-URL")).toBe("https://5173-fake.e2b.app/");
  expect(open.headers.get("e2b-traffic-access-token")).toBe("t");
  expect((await resolve(subdomain, 3000)).status).toBe(403);
  // Signed in as the owner, the private port resolves to its own upstream.
  const signedIn = spyOn(auth.api, "getSession").mockResolvedValue({
    user: { id: userId },
  } as never);
  try {
    const owner = await resolve(subdomain, 3000);
    expect(owner.status).toBe(200);
    expect(owner.headers.get("X-Upstream-URL")).toBe("https://3000-fake.e2b.app/");
    expect(owner.headers.get("e2b-traffic-access-token")).toBe("t");
  } finally {
    signedIn.mockRestore();
  }

  // Boat's access cookie reaches the proxy as the header its Caddy route turns back into one.
  previewHeaders = { cookie: "_port_auth=boat-token" };
  try {
    const boat = await caller(userId).create({
      provider: "boat",
      name: "boat",
      lifetimeMinutes: 30,
    });
    await caller(userId).preview({ sandboxId: boat.id, port: 8080, public: true });
    const [boatRow] = await db.select().from(workspace).where(eq(workspace.id, boat.id));
    const routed = await resolve(boatRow!.subdomain!, 8080);
    expect(routed.status).toBe(200);
    expect(routed.headers.get("X-GitTerm-Boat-Token")).toBe("boat-token");
  } finally {
    previewHeaders = { "e2b-traffic-access-token": "t" };
    await terminateAll(userId);
  }
});

const internal = () =>
  internalRouter.createCaller({
    internalApiKey: process.env.INTERNAL_API_KEY,
    e2bSignature: null,
  } as unknown as Context);

async function terminateAll(id: string) {
  const rows = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.userId, id));
  for (const row of rows)
    await caller(id)
      .terminate({ sandboxId: row.id })
      .catch(() => {});
}

integration(
  "#4 a failed provider deletion stays queued and is retried, never reported done",
  async () => {
    await terminateAll(userId);
    const sandbox = await caller(userId).create({ name: "delete-fails", lifetimeMinutes: 5 });
    const [row] = await db.select().from(workspace).where(eq(workspace.id, sandbox.id));
    const providerId = row!.externalInstanceId.split(":").at(-1)!;

    failDestroys = 1;
    const before = destroyed.length;
    await expect(caller(userId).terminate({ sandboxId: sandbox.id })).rejects.toThrow();
    expect(destroyed.slice(before)).toEqual([providerId]);
    // The cleanup is durably queued and the sandbox is not reported as deleted.
    expect(
      await db
        .select()
        .from(workspaceTermination)
        .where(eq(workspaceTermination.workspaceId, sandbox.id)),
    ).toHaveLength(1);
    expect((await caller(userId).get({ sandboxId: sandbox.id })).deleted).toBe(false);

    // A retry calls the provider again and only then confirms deletion.
    await caller(userId).terminate({ sandboxId: sandbox.id });
    expect(destroyed.slice(before)).toEqual([providerId, providerId]);
    expect(
      await db
        .select()
        .from(workspaceTermination)
        .where(eq(workspaceTermination.workspaceId, sandbox.id)),
    ).toHaveLength(0);
    expect((await caller(userId).get({ sandboxId: sandbox.id })).deleted).toBe(true);
  },
);

/** Delivers a signed E2B lifecycle webhook, as the listener does. */
async function e2bWebhook(providerId: string, type: "paused" | "resumed") {
  const event = {
    id: randomUUID(),
    version: "v2",
    type: `sandbox.lifecycle.${type}`,
    timestamp: new Date(Date.now() + 1_000).toISOString(),
    eventData: {},
    event_category: "lifecycle",
    event_label: type === "paused" ? "pause" : "resume",
    sandbox_id: providerId,
    sandbox_execution_id: randomUUID(),
    sandbox_template_id: "base",
    sandbox_build_id: "b",
    sandbox_team_id: randomUUID(),
  };
  const rawBody = JSON.stringify(event);
  const signature = createHash("sha256")
    .update(WEBHOOK_SECRET + rawBody)
    .digest("base64")
    .replace(/=+$/, "");
  return (await internalRouter
    .createCaller({
      internalApiKey: process.env.INTERNAL_API_KEY,
      e2bSignature: signature,
    } as unknown as Context)
    .processE2bWebhook({ ...event, rawBody } as never)) as { updated: unknown[] };
}

integration("#5 a signed E2B pause webhook settles a sandbox's status and usage", async () => {
  await terminateAll(userId);
  const sandbox = await caller(userId).create({ name: "webhook", lifetimeMinutes: 5 });
  const [row] = await db.select().from(workspace).where(eq(workspace.id, sandbox.id));
  const providerId = row!.externalInstanceId.split(":").at(-1)!;
  expect((await e2bWebhook(providerId, "paused")).updated).toHaveLength(1);
  expect((await caller(userId).get({ sandboxId: sandbox.id })).status).toBe("paused");
  const sessions = await db
    .select()
    .from(usageSession)
    .where(eq(usageSession.workspaceId, sandbox.id));
  expect(sessions[0]!.stoppedAt).not.toBeNull();
});

integration("a sandbox is provisioned at the machine profile it is billed at", async () => {
  await terminateAll(userId);
  machineAccess = "smallest";
  try {
    const sandbox = await caller(userId).create({ name: "small", lifetimeMinutes: 5 });
    const [row] = await db
      .select({ handle: workspace.externalInstanceId, profile: machineProfile })
      .from(workspace)
      .innerJoin(machineProfile, eq(workspace.machineProfileId, machineProfile.id))
      .where(eq(workspace.id, sandbox.id));
    expect(row!.profile.key).toBe("small");
    expect(requested.get(row!.handle.split(":").at(-1)!)).toEqual({
      template: "gitterm-sandbox",
      machine: { templateSuffix: "-sm" },
    });
  } finally {
    machineAccess = "any";
  }
});

integration(
  "a resume webhook that arrives during the resume leaves the sandbox running",
  async () => {
    await terminateAll(userId);
    const sandbox = await caller(userId).create({ name: "resume-race", lifetimeMinutes: 5 });
    const [row] = await db.select().from(workspace).where(eq(workspace.id, sandbox.id));
    const providerId = row!.externalInstanceId.split(":").at(-1)!;
    await e2bWebhook(providerId, "paused");
    duringResume = async (id) => {
      expect((await e2bWebhook(id, "resumed")).updated).toHaveLength(1);
    };
    try {
      const restarted = await workspaceRouter
        .createCaller({ session: { user: { id: userId } } } as unknown as Context)
        .restartWorkspace({ workspaceId: sandbox.id });
      expect(restarted.status).toBe("running");
    } finally {
      duringResume = undefined;
    }
    expect((await caller(userId).get({ sandboxId: sandbox.id })).status).toBe("running");
    const open = await db
      .select()
      .from(usageSession)
      .where(eq(usageSession.workspaceId, sandbox.id));
    expect(open.filter((session) => !session.stoppedAt)).toHaveLength(1);
  },
);

integration("#5 a signed Boat archive webhook pauses a Boat sandbox", async () => {
  await terminateAll(userId);
  const sandbox = await caller(userId).create({
    provider: "boat",
    name: "boat-webhook",
    lifetimeMinutes: 5,
  });
  const [row] = await db.select().from(workspace).where(eq(workspace.id, sandbox.id));
  expect(row!.externalInstanceId).toStartWith("sandbox:boat:");
  const boxId = row!.externalInstanceId.split(":").at(-1)!;
  const event = {
    id: randomUUID(),
    type: "box.archived",
    createdAt: new Date(Date.now() + 1_000).toISOString(),
    data: { box: { id: boxId } },
  };
  const rawBody = JSON.stringify(event);
  const delivery = randomUUID();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v1=${createHmac("sha256", WEBHOOK_SECRET).update(`${delivery}.${timestamp}.${rawBody}`).digest("hex")}`;
  const result = await internal().processBoatWebhook({
    ...event,
    rawBody,
    delivery,
    timestamp,
    signature,
  } as never);
  expect((result as { updated: unknown[] }).updated).toHaveLength(1);
  expect((await caller(userId).get({ sandboxId: sandbox.id })).status).toBe("paused");
});

integration("#6 concurrent creates cannot exceed the plan's workspace limit", async () => {
  await terminateAll(userId);
  workspaceLimit = 1;
  try {
    const results = await Promise.allSettled(
      [1, 2, 3].map((index) =>
        caller(userId).create({ name: `race-${index}`, lifetimeMinutes: 5 }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  } finally {
    workspaceLimit = 2;
    await terminateAll(userId);
  }
});

const handleOf = async (id: string) =>
  (await db.select().from(workspace).where(eq(workspace.id, id)))[0]!.externalInstanceId;

integration(
  "#4 reconcile never clears a provider handle on the provider's word alone",
  async () => {
    await terminateAll(userId);
    const sandbox = await caller(userId).create({ name: "reconcile", lifetimeMinutes: 5 });
    const handle = await handleOf(sandbox.id);
    providerStates.set(handle.split(":").at(-1)!, "terminated");
    const seen = await caller(userId).get({ sandboxId: sandbox.id });
    // Billing stops, but deletion is only recorded once cleanup confirms it.
    expect(seen.status).toBe("terminated");
    expect(seen.deleted).toBe(false);
    expect(await handleOf(sandbox.id)).toBe(handle);
    expect(
      await db
        .select()
        .from(workspaceTermination)
        .where(eq(workspaceTermination.workspaceId, sandbox.id)),
    ).toHaveLength(1);
  },
);

integration(
  "#5 terminate reports deletion only after the provider confirms it",
  async () => {
    await terminateAll(userId);
    const sandbox = await caller(userId).create({ name: "confirm", lifetimeMinutes: 5 });
    acceptOnlyDestroys = true;
    try {
      await expect(caller(userId).terminate({ sandboxId: sandbox.id })).rejects.toThrow();
      expect((await caller(userId).get({ sandboxId: sandbox.id })).deleted).toBe(false);
      expect(await handleOf(sandbox.id)).not.toBe("");
      expect(
        await db
          .select()
          .from(workspaceTermination)
          .where(eq(workspaceTermination.workspaceId, sandbox.id)),
      ).toHaveLength(1);
    } finally {
      acceptOnlyDestroys = false;
    }
    // Once the provider reports it gone, a retry confirms and completes cleanup.
    providerStates.set((await handleOf(sandbox.id)).split(":").at(-1)!, "terminated");
    expect(await caller(userId).terminate({ sandboxId: sandbox.id })).toMatchObject({
      deleted: true,
    });
    expect(await handleOf(sandbox.id)).toBe("");
  },
  60_000,
);

integration("#4 AWS status errors are failures, not deletions", async () => {
  const { createAwsSandboxTransport } = await import("../providers/aws/sandbox");
  const { AwsProvider } = await import("../providers/aws");
  const denied = Object.assign(
    new Error("User is not authorized to perform: ecs:DescribeServices"),
    {
      name: "AccessDeniedException",
    },
  );
  const spy = spyOn(AwsProvider.prototype, "getStatus").mockRejectedValue(denied);
  try {
    await expect(createAwsSandboxTransport("aws-provider").info("{}")).rejects.toThrow(
      /not authorized/,
    );
  } finally {
    spy.mockRestore();
  }
});
