import { afterAll, expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const requests: string[] = [];
const api = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    expect(request.headers.get("x-internal-key")).toBe("reaper-test-key");
    const procedures = new URL(request.url).pathname.replace("/trpc/", "").split(",");
    const results = procedures.map((procedure) => {
      requests.push(procedure);
      const data =
        procedure === "internal.retryWorkspaceTerminations"
          ? { terminated: 0, failed: 0 }
          : procedure === "internal.keepAlwaysOnWorkspacesAlive"
            ? { renewed: 0 }
            : procedure === "internal.runBillingTasks"
              ? { notices: 0, sent: 0 }
              : procedure === "internal.sweepAwsResourcesInternal"
                ? {
                    retriedWorkspaces: 0,
                    runtimeSecretsDeleted: 0,
                    servicesDeleted: 0,
                    taskDefinitionsDeregistered: 0,
                    rulesDeleted: 0,
                    targetGroupsDeleted: 0,
                    accessPointsDeleted: 0,
                    cleanupFailures: [],
                    unresolvedCleanupCount: 0,
                  }
                : [];
      return { result: { data } };
    });
    return Response.json(results);
  },
});
afterAll(() => api.stop(true));

async function startReaper(app: "anon-reaper" | "worker", mode = "managed", idle = true) {
  const name = app === "anon-reaper" ? "anon-reaper" : "idle-reaper";
  const entry = process.env.GITTERM_REAPER_TEST_BUNDLED
    ? `apps/${app}/dist/${name}.mjs`
    : `apps/${app}/src/${name}.ts`;
  const child = Bun.spawn([process.execPath, "--no-env-file", resolve(root, entry)], {
    cwd: root,
    env: {
      NODE_ENV: "production",
      DEPLOYMENT_MODE: mode,
      SERVER_URL: api.url.origin,
      INTERNAL_API_KEY: "reaper-test-key",
      REAP_INTERVAL_MINUTES: "0",
      ENABLE_IDLE_REAPING: String(idle),
      DOTENV_CONFIG_PATH: resolve(root, ".reaper-startup-test-no-env"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return stdout;
}

test("managed anonymous reaper starts without API server or Polar credentials", async () => {
  const stdout = await startReaper("anon-reaper");
  expect(stdout).toContain("Completed. Found 0 expired workspace(s)");
  expect(requests).toContain("internal.getAnonStragglerWorkspaces");
});

test("self-hosted anonymous reaper skips without contacting the API", async () => {
  const before = requests.length;
  expect(await startReaper("anon-reaper", "self-hosted")).toContain("Skipping outside managed");
  expect(requests.length).toBe(before);
});

test("managed idle reaper starts without API server or Polar credentials", async () => {
  const stdout = await startReaper("worker");
  expect(stdout).toContain("Pass completed. Lifecycle transitions: 0");
  expect(requests).toContain("internal.getIdleWorkspaces");
  expect(requests).toContain("internal.runBillingTasks");
  expect(requests).toContain("internal.retryWorkspaceTerminations");
});

test("idle reaping can be disabled without disabling billing and cleanup", async () => {
  const before = requests.length;
  expect(await startReaper("worker", "managed", false)).toContain("Idle reaping disabled");
  const called = requests.slice(before);
  expect(called).not.toContain("internal.getIdleWorkspaces");
  expect(called).not.toContain("internal.getLongTermInactiveWorkspaces");
  expect(called).toContain("internal.runBillingTasks");
  expect(called).toContain("internal.getAutoTerminateDueWorkspaces");
  expect(called).toContain("internal.retryWorkspaceTerminations");
});
