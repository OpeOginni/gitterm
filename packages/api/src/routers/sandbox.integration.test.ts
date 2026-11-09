import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import { createHash, createHmac, randomUUID } from "node:crypto";
import type { Context } from "../context";
import { SandboxProviderError } from "@gitterm/agent-runtime/sandbox/types";

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
const { sandboxSnapshot, usageSession, workspace, workspaceTermination } =
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
const { getWorkspaceRouteAccess } = await import("../service/workspace-route-access");
const { holdWorkspaceOperation } = await import("../service/workspace-operation");
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
let snapshotLimit: number | null = null;
/** Provider snapshots saved and deleted; a save fails while `failSnapshots` is set. */
const savedSnapshots: string[] = [];
const deletedSnapshots: string[] = [];
let failSnapshots = false;
let machineAccess: "any" | "smallest" = "any";
/** What each create asked the provider for. */
const requested = new Map<
  string,
  { template?: string; machine?: Record<string, unknown>; snapshot?: string }
>();
let failDestroys = 0;
/** Provider-side state; destroy marks a sandbox gone unless `acceptOnlyDestroys` is set. */
const providerStates = new Map<string, "running" | "paused" | "terminated">();
let acceptOnlyDestroys = false;
const WEBHOOK_SECRET = "test-webhook-secret";
const mocks: { mockRestore(): void }[] = [];
/** Runs inside the fake provider's resume call. */
let duringResume: ((id: string) => Promise<void>) | undefined;
/** The fake provider rejects pauses, as for a sandbox it no longer has. */
let failPauses = false;
/** Runs inside the fake provider's status read. */
let duringInfo: (() => Promise<void>) | undefined;
/** The fake provider creates this sandbox, fails to set it up, and can't delete it. */
let leftoverOnCreate: string | undefined;
/** Runs inside a create that is about to fail with `leftoverOnCreate`. */
let beforeLeftover: ((workspaceId: string) => Promise<void>) | undefined;
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
      snapshot?: string;
    }) {
      if (leftoverOnCreate) {
        await beforeLeftover?.(input.labels.gitterm_workspace!);
        const error = new SandboxProviderError("provider", "E2B failed to prepare the sandbox.");
        error.leftoverId = leftoverOnCreate;
        throw error;
      }
      const id = `fake-${randomUUID()}`;
      providerPublic.push(input.publicPreviews === true);
      created.set(id, { ...input.labels, template: input.template ?? "" });
      requested.set(id, {
        template: input.template,
        machine: input.machine,
        snapshot: input.snapshot,
      });
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
    async pause() {
      if (failPauses) throw new Error("The sandbox was not found.");
    },
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
      await duringInfo?.();
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
    snapshots: {
      async create(_id: string, name: string) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (failSnapshots) throw new SandboxProviderError("provider", "E2B failed to snapshot.");
        savedSnapshots.push(name);
        return `e2b-${name}`;
      },
      async delete(snapshotId: string) {
        deletedSnapshots.push(snapshotId);
      },
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
        maxSnapshots: snapshotLimit,
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
  await db.delete(sandboxSnapshot).where(inArray(sandboxSnapshot.userId, [userId, otherId]));
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
  await caller(userId).preview({ sandboxId: sandbox.id, port: 3000, public: true });
  const [row] = await db.select().from(workspace).where(eq(workspace.id, sandbox.id));
  const providerId = row!.externalInstanceId.split(":").at(-1)!;
  expect((await e2bWebhook(providerId, "paused")).updated).toHaveLength(1);
  expect((await caller(userId).get({ sandboxId: sandbox.id })).status).toBe("paused");
  const sessions = await db
    .select()
    .from(usageSession)
    .where(eq(usageSession.workspaceId, sandbox.id));
  expect(sessions[0]!.stoppedAt).not.toBeNull();
  // The preview keeps its provider access, so its shared URL works again after a resume.
  expect(await getWorkspaceRouteAccess(sandbox.id, 3000)).toEqual({
    "e2b-traffic-access-token": "t",
  });
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
  "a Gitterm sandbox runs at the chosen size, and Gitterm is offered for workspaces",
  async () => {
    await terminateAll(userId);
    // What ensureComputeProvider creates on gitterm.dev.
    const [compute] = await db
      .insert(cloudProvider)
      .values({
        name: `Gitterm ${randomUUID()}`,
        providerKey: "gitterm",
        isSandbox: true,
        supportsRegions: false,
        machineSelectionPolicy: { mode: "profiles" },
      })
      .returning();
    try {
      for (const [key, vcpus, isDefault] of [
        ["small", 2, false],
        ["medium", 4, true],
        ["large", 8, false],
      ] as const)
        await db.insert(machineProfile).values({
          cloudProviderId: compute!.id,
          key,
          name: key,
          vcpus,
          memoryGb: vcpus * 2,
          providerOptions: { size: key },
          isDefault,
        });
      const sandbox = await caller(userId).create({
        provider: "gitterm",
        name: "compute",
        lifetimeMinutes: 5,
        machine: "large",
      });
      const [row] = await db.select().from(workspace).where(eq(workspace.id, sandbox.id));
      expect(row!.externalInstanceId).toStartWith("sandbox:gitterm:");
      expect(requested.get(row!.externalInstanceId.split(":").at(-1)!)).toEqual({
        template: undefined,
        machine: { size: "large" },
      });
      const providers = workspaceRouter.createCaller({
        session: { user: { id: userId } },
      } as unknown as Context);
      const forWorkspaces = (await providers.listCloudProviders({ cloudOnly: true }))
        .cloudProviders;
      expect(forWorkspaces.some((provider) => provider.id === compute!.id)).toBe(true);
    } finally {
      await terminateAll(userId);
      await db.delete(cloudProvider).where(eq(cloudProvider.id, compute!.id));
    }
  },
);

integration("the caller chooses a machine profile within the plan", async () => {
  await terminateAll(userId);
  const sandbox = await caller(userId).create({
    name: "large",
    lifetimeMinutes: 5,
    machine: "large",
  });
  const [row] = await db.select().from(workspace).where(eq(workspace.id, sandbox.id));
  expect(requested.get(row!.externalInstanceId.split(":").at(-1)!)?.machine).toEqual({
    templateSuffix: "-lg",
  });
  await terminateAll(userId);

  machineAccess = "smallest";
  try {
    await expect(
      caller(userId).create({ name: "denied", lifetimeMinutes: 5, machine: "large" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("small") });
  } finally {
    machineAccess = "any";
  }
  await expect(
    caller(userId).create({ name: "unknown", lifetimeMinutes: 5, machine: "huge" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
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

integration("parallel resumes of a paused sandbox join one restart", async () => {
  await terminateAll(userId);
  const sandbox = await caller(userId).create({ name: "parallel-resume", lifetimeMinutes: 5 });
  const [row] = await db.select().from(workspace).where(eq(workspace.id, sandbox.id));
  const providerId = row!.externalInstanceId.split(":").at(-1)!;
  await e2bWebhook(providerId, "paused");
  let resumes = 0;
  duringResume = async () => {
    resumes++;
    await new Promise((resolve) => setTimeout(resolve, 200));
  };
  try {
    const workspaces = workspaceRouter.createCaller({
      session: { user: { id: userId } },
    } as unknown as Context);
    const results = await Promise.all(
      [1, 2, 3].map(() => workspaces.restartWorkspace({ workspaceId: sandbox.id })),
    );
    for (const result of results) expect(["running", "pending"]).toContain(result.status);
  } finally {
    duringResume = undefined;
  }
  expect(resumes).toBe(1);
  // E2B reports the resume by webhook.
  await e2bWebhook(providerId, "resumed");
  expect((await caller(userId).get({ sandboxId: sandbox.id })).status).toBe("running");
});

integration("a sandbox the provider made but couldn't delete is queued for cleanup", async () => {
  await terminateAll(userId);
  const leftover = `fake-${randomUUID()}`;
  leftoverOnCreate = leftover;
  try {
    await expect(caller(userId).create({ name: "leftover", lifetimeMinutes: 5 })).rejects.toThrow();
  } finally {
    leftoverOnCreate = undefined;
  }
  const [row] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.externalInstanceId, `sandbox:e2b:${leftover}`));
  expect(row!.status).toBe("terminated");
  await internal().retryWorkspaceTerminations();
  expect(destroyed).toContain(leftover);
  const [after] = await db.select().from(workspace).where(eq(workspace.id, row!.id));
  expect(after!.externalInstanceId).toBe("");
});

integration(
  "a leftover from a failed create outlives a cleanup that started before it",
  async () => {
    await terminateAll(userId);
    const leftover = `fake-${randomUUID()}`;
    let workspaceId = "";
    let earlierGeneration = "";
    leftoverOnCreate = leftover;
    // A cleanup claims the queue entry while the handle is still empty.
    beforeLeftover = async (id) => {
      workspaceId = id;
      const [claimed] = await db
        .insert(workspaceTermination)
        .values({ workspaceId: id })
        .returning();
      earlierGeneration = claimed!.generation;
    };
    try {
      await expect(caller(userId).create({ name: "late", lifetimeMinutes: 5 })).rejects.toThrow();
    } finally {
      leftoverOnCreate = undefined;
      beforeLeftover = undefined;
    }
    // That cleanup finishes: it had no handle to delete, and removes only its own generation.
    await db
      .delete(workspaceTermination)
      .where(
        and(
          eq(workspaceTermination.workspaceId, workspaceId),
          eq(workspaceTermination.generation, earlierGeneration),
        ),
      );
    const queued = await db
      .select()
      .from(workspaceTermination)
      .where(eq(workspaceTermination.workspaceId, workspaceId));
    expect(queued).toHaveLength(1);
    await internal().retryWorkspaceTerminations();
    expect(destroyed).toContain(leftover);
  },
);

integration(
  "a pending restart is its owner's while the lease is held, then the provider's",
  async () => {
    await terminateAll(userId);
    const sandbox = await caller(userId).create({ name: "leased", lifetimeMinutes: 5 });
    const restarting = (operationLeaseUntil: Date) =>
      db
        .update(workspace)
        .set({ status: "pending", upstreamUrl: "https://agent.test", operationLeaseUntil })
        .where(eq(workspace.id, sandbox.id));
    const access = () =>
      workspaceRouter
        .createCaller({ session: { user: { id: userId } } } as unknown as Context)
        .getRuntimeAccess({ workspaceId: sandbox.id });
    const status = async () =>
      (await db.select().from(workspace).where(eq(workspace.id, sandbox.id)))[0]!.status;

    // The provider already reports the machine running; the restart hasn't settled yet.
    await restarting(new Date(Date.now() + 60_000));
    await access();
    expect(await status()).toBe("pending");
    // Its owner died: the lease lapsed without renewal.
    await restarting(new Date(Date.now() - 1_000));
    await access();
    expect(await status()).toBe("running");
  },
);

integration("an operation releases its lease, but never one a later owner holds", async () => {
  await terminateAll(userId);
  const sandbox = await caller(userId).create({ name: "lease", lifetimeMinutes: 5 });
  const lease = async () =>
    (await db.select().from(workspace).where(eq(workspace.id, sandbox.id)))[0]!.operationLeaseUntil;
  await holdWorkspaceOperation(sandbox.id, async () => {
    expect((await lease())!.getTime()).toBeGreaterThan(Date.now());
  });
  expect(await lease()).toBeNull();
  const later = new Date(Date.now() + 90_000);
  await holdWorkspaceOperation(sandbox.id, async () => {
    await db
      .update(workspace)
      .set({ operationLeaseUntil: later })
      .where(eq(workspace.id, sandbox.id));
  });
  expect(await lease()).toEqual(later);
});

integration("runtime access never publishes a restart another call has claimed", async () => {
  await terminateAll(userId);
  const sandbox = await caller(userId).create({ name: "claimed", lifetimeMinutes: 5 });
  const [row] = await db.select().from(workspace).where(eq(workspace.id, sandbox.id));
  await e2bWebhook(row!.externalInstanceId.split(":").at(-1)!, "paused");
  // A restart claims it while runtime access asks the provider, which already says running.
  duringInfo = async () => {
    await db
      .update(workspace)
      .set({ status: "pending", updatedAt: new Date() })
      .where(eq(workspace.id, sandbox.id));
  };
  try {
    await workspaceRouter
      .createCaller({ session: { user: { id: userId } } } as unknown as Context)
      .getRuntimeAccess({ workspaceId: sandbox.id });
  } finally {
    duringInfo = undefined;
  }
  const [after] = await db.select().from(workspace).where(eq(workspace.id, sandbox.id));
  expect(after!.status).toBe("pending");
});

integration("an idle pause of a sandbox the provider lost terminates it", async () => {
  await terminateAll(userId);
  const sandbox = await caller(userId).create({ name: "lost", lifetimeMinutes: 5 });
  const [row] = await db.select().from(workspace).where(eq(workspace.id, sandbox.id));
  const providerId = row!.externalInstanceId.split(":").at(-1)!;
  providerStates.set(providerId, "terminated");
  failPauses = true;
  try {
    await internal().pauseWorkspaceInternal({ workspaceId: sandbox.id, stopSource: "idle" });
  } finally {
    failPauses = false;
  }
  const [after] = await db.select().from(workspace).where(eq(workspace.id, sandbox.id));
  expect(after!.status).toBe("terminated");
  expect(after!.externalInstanceId).toBe("");
  const sessions = await db
    .select()
    .from(usageSession)
    .where(eq(usageSession.workspaceId, sandbox.id));
  expect(sessions.filter((session) => !session.stoppedAt)).toHaveLength(0);
});

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

integration(
  "snapshots are limited per plan, owned by their user, and start new sandboxes",
  async () => {
    const previousLimit = workspaceLimit;
    workspaceLimit = 10;
    try {
      const sandbox = await caller(userId).create({ name: "snap", lifetimeMinutes: 30 });

      snapshotLimit = 0;
      await expect(
        caller(userId).saveSnapshot({ sandboxId: sandbox.id, label: "deps" }),
      ).rejects.toThrow("doesn't include sandbox snapshots");

      // Parallel saves can't pass the limit.
      snapshotLimit = 2;
      const results = await Promise.allSettled(
        ["a", "b", "c"].map((label) =>
          caller(userId).saveSnapshot({ sandboxId: sandbox.id, label }),
        ),
      );
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
      const refused = results.find(
        (result) => result.status === "rejected",
      ) as PromiseRejectedResult;
      expect(String(refused.reason)).toContain("plan limit of 2 sandbox snapshots");
      // Provider names come from Gitterm's ids, never from the caller's label.
      expect(savedSnapshots.every((name) => /^gitterm-[0-9a-f-]{36}$/.test(name))).toBe(true);

      const listed = await caller(userId).snapshots();
      expect(listed).toHaveLength(2);
      expect(await caller(otherId).snapshots()).toEqual([]);
      await expect(caller(otherId).deleteSnapshot({ snapshotId: listed[0]!.id })).rejects.toThrow(
        "Snapshot not found",
      );
      await expect(
        caller(otherId).create({ lifetimeMinutes: 5, snapshotId: listed[0]!.id }),
      ).rejects.toThrow("Snapshot not found");

      // A new sandbox starts from it, at the size it was saved at.
      const [source] = await db.select().from(workspace).where(eq(workspace.id, sandbox.id));
      const fromSnapshot = await caller(userId).create({
        lifetimeMinutes: 5,
        snapshotId: listed[0]!.id,
      });
      expect(fromSnapshot.machineProfileId).toBe(source!.machineProfileId);
      const [started] = await db.select().from(workspace).where(eq(workspace.id, fromSnapshot.id));
      const providerId = started!.externalInstanceId.slice("sandbox:e2b:".length);
      expect(requested.get(providerId)?.snapshot).toBe(`e2b-gitterm-${listed[0]!.id}`);
      // The sandbox remembers its snapshot, so the dashboard can show where it came from.
      expect(started!.snapshotId).toBe(listed[0]!.id);

      await db
        .update(machineProfile)
        .set({ isEnabled: false })
        .where(eq(machineProfile.id, source!.machineProfileId!));
      try {
        await expect(
          caller(userId).create({ lifetimeMinutes: 5, snapshotId: listed[0]!.id }),
        ).rejects.toThrow("saved at a size your plan can no longer use");
      } finally {
        await db
          .update(machineProfile)
          .set({ isEnabled: true })
          .where(eq(machineProfile.id, source!.machineProfileId!));
      }

      // Deleting removes it at the provider and frees the slot; a failed save takes none.
      await caller(userId).deleteSnapshot({ snapshotId: listed[0]!.id });
      expect(deletedSnapshots).toEqual([`e2b-gitterm-${listed[0]!.id}`]);
      const [afterDelete] = await db
        .select({ snapshotId: workspace.snapshotId })
        .from(workspace)
        .where(eq(workspace.id, fromSnapshot.id));
      expect(afterDelete!.snapshotId).toBeNull();
      failSnapshots = true;
      await expect(
        caller(userId).saveSnapshot({ sandboxId: sandbox.id, label: "x" }),
      ).rejects.toThrow("E2B failed to snapshot");
      failSnapshots = false;
      await caller(userId).saveSnapshot({ sandboxId: sandbox.id, label: "d" });
      expect(await caller(userId).snapshots()).toHaveLength(2);

      for (const id of [sandbox.id, fromSnapshot.id])
        await caller(userId).terminate({ sandboxId: id });
    } finally {
      snapshotLimit = null;
      failSnapshots = false;
      workspaceLimit = previousLimit;
    }
  },
);
