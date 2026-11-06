import { afterAll, expect, spyOn, test } from "bun:test";
import type { SandboxCreateInput } from "@gitterm/agent-runtime/sandbox/types";
import * as transportModule from "../../service/sandbox-transport";
import * as timeouts from "../../service/workspace-timeouts";
import type { WorkspaceConfig } from "../compute";
import { GittermProvider } from ".";

const created: SandboxCreateInput[] = [];
const commands: { command: string; cwd?: string }[] = [];
const files = new Map<string, string>();
const destroyed: string[] = [];
let failOn: string | undefined;

const fake = {
  provider: "gitterm" as const,
  home: "/home/user",
  async create(input: SandboxCreateInput) {
    created.push(input);
    return { id: "sbx1", state: "running" as const, labels: {}, startedAt: null, expiresAt: null };
  },
  async run(_id: string, command: string, options: { cwd?: string } = {}) {
    commands.push({ command, cwd: options.cwd });
    if (failOn && command.includes(failOn)) return { exitCode: 1, stdout: "", stderr: "nope" };
    return { exitCode: 0, stdout: command === "mint-token" ? "pairing-token\n" : "", stderr: "" };
  },
  async writeFile(_id: string, path: string, data: Uint8Array) {
    files.set(path, Buffer.from(data).toString());
  },
  async preview(_id: string, port: number) {
    // Like Boat: the access token is a cookie, which the proxy takes as a named header.
    return { url: `https://${port}.preview.example`, headers: { cookie: "_port_auth=token" } };
  },
  async destroy(id: string) {
    destroyed.push(id);
  },
};

const mocks = [
  spyOn(transportModule, "managedSandboxTransport").mockResolvedValue(fake as never),
  spyOn(timeouts, "getWorkspaceIdleTimeoutMs").mockResolvedValue(30 * 60_000),
];
afterAll(() => mocks.forEach((mock) => mock.mockRestore()));

const config = (): WorkspaceConfig => ({
  workspaceId: "ws1",
  userId: "u1",
  imageId: "image",
  subdomain: "ws1",
  imageProviderMetadata: { gitterm: { image: "gitterm-opencode-server", size: "large" } },
  environmentVariables: { USER_VAR: "from-user" } as never,
  provisioningSpec: {
    repo: { url: "https://github.com/acme/app", name: "app", branch: "main", authToken: "t" },
    agent: {
      files: [
        { path: "~/.config/agent.json", contentBase64: Buffer.from("{}").toString("base64") },
        {
          path: "/run/gitterm/secret",
          contentBase64: Buffer.from("s").toString("base64"),
          mode: 0o600,
        },
      ],
      env: { AGENT_VAR: "agent", USER_VAR: "from-agent" },
      usesServerPassword: false,
      serve: {
        command: "opencode serve --port 4096",
        port: 4096,
        accessCredentialCommand: "mint-token",
      },
    },
    workspaceProfile: "standard",
    editorAccessEnabled: false,
  } as never,
});

test("a Gitterm workspace is set up through sandbox calls and keeps a sandbox handle", async () => {
  const info = await new GittermProvider().createWorkspace(config());

  expect(created[0]).toMatchObject({
    template: "gitterm-opencode-server",
    machine: { size: "large" },
    onTimeout: "pause",
    timeoutMs: 30 * 60_000,
    labels: { gitterm_workspace: "ws1" },
    // The workspace's own env wins over the agent's defaults.
    env: { AGENT_VAR: "agent", USER_VAR: "from-user" },
  });
  // A resume brings the agent back only if it isn't already answering.
  expect(created[0]!.resumeCommand).toContain("/dev/tcp/127.0.0.1/4096");
  expect(created[0]!.resumeCommand).toContain("cd '/home/user/workspace/app'");

  const ran = commands.map((entry) => entry.command);
  expect(ran.some((command) => command.includes("credential.helper"))).toBe(true);
  expect(commands.find((entry) => entry.command.includes("git clone"))?.cwd).toBe(
    "/home/user/workspace/app",
  );
  expect(files.get("/home/user/.config/agent.json")).toBe("{}");
  expect(ran.some((command) => command.startsWith("sudo -n mkdir -p '/run/gitterm'"))).toBe(true);
  expect(ran.some((command) => command.includes("nohup setsid bash -lc"))).toBe(true);

  expect(info).toMatchObject({
    externalServiceId: "sandbox:gitterm:sbx1",
    upstreamUrl: "https://4096.preview.example",
    upstreamAccess: { headers: { "X-GitTerm-Boat-Token": "token" } },
    accessCredential: "pairing-token",
  });

  const port = await new GittermProvider().createOrGetExposedPortDomain(
    "sandbox:gitterm:sbx1",
    3000,
  );
  expect(port).toEqual({
    domain: "https://3000.preview.example",
    externalPortDomainId: "sbx1:3000",
    upstreamAccess: { headers: { "X-GitTerm-Boat-Token": "token" } },
  });
});

test("a failed clone says why and removes the sandbox", async () => {
  failOn = "git clone";
  try {
    await expect(new GittermProvider().createWorkspace(config())).rejects.toMatchObject({
      name: "WorkspaceProvisionError",
      code: "BAD_REQUEST",
      message: expect.stringContaining(
        "Couldn't clone https://github.com/acme/app (branch main): nope",
      ),
    });
    expect(destroyed).toEqual(["sbx1"]);
  } finally {
    failOn = undefined;
  }
});

test("an image the sandbox service doesn't offer is refused before anything is created", async () => {
  const before = created.length;
  await expect(
    new GittermProvider().createWorkspace({ ...config(), imageProviderMetadata: {} }),
  ).rejects.toThrow("not available on Gitterm");
  expect(created).toHaveLength(before);
});
