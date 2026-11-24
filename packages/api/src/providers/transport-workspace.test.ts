import { afterAll, expect, spyOn, test } from "bun:test";
import {
  SandboxProviderError,
  type SandboxCreateInput,
} from "@gitterm/agent-runtime/sandbox/types";
import * as transportModule from "../service/sandbox-transport";
import * as timeouts from "../service/workspace-timeouts";
import type { WorkspaceConfig } from "./compute";
import { withSandboxHandles } from "./sandbox-handles";
import { gittermProvider, TransportWorkspaceProvider } from "./transport-workspace";

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
  async resume() {},
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
  imageProviderMetadata: { gitterm: { image: "gitterm-opencode-server", size: "medium" } },
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
  const info = await gittermProvider.createWorkspace(config());

  expect(created[0]).toMatchObject({
    template: "gitterm-opencode-server",
    machine: { size: "medium" },
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

  const port = await gittermProvider.createOrGetExposedPortDomain("sandbox:gitterm:sbx1", 3000);
  expect(port).toEqual({
    domain: "https://3000.preview.example",
    externalPortDomainId: "sbx1:3000",
    upstreamAccess: { headers: { "X-GitTerm-Boat-Token": "token" } },
  });
});

test("a workspace started from a project snapshot refreshes its clone instead of cloning", async () => {
  created.length = 0;
  commands.length = 0;
  await gittermProvider.createWorkspace({ ...config(), snapshot: "snap1" });
  expect(created[0]).toMatchObject({ snapshot: "snap1", template: "gitterm-opencode-server" });
  const checkout = commands.find((entry) => entry.command.includes("git fetch --prune origin"));
  expect(checkout?.cwd).toBe("/home/user/workspace/app");
  // Still a clone when the snapshot turns out to hold no checkout.
  expect(checkout?.command).toContain(
    "git clone --branch 'main' 'https://github.com/acme/app.git' .",
  );
  // Credentials and agent files are written afresh, and the agent is started as usual.
  expect(commands.some((entry) => entry.command.includes("credential.helper"))).toBe(true);
  expect(files.get("/home/user/.config/agent.json")).toBe("{}");
  expect(commands.some((entry) => entry.command.includes("opencode serve --port 4096"))).toBe(true);
});

test("a failed clone says why and removes the sandbox", async () => {
  failOn = "git clone";
  try {
    await expect(gittermProvider.createWorkspace(config())).rejects.toMatchObject({
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

test("a sandbox the provider made but couldn't delete is recorded, so cleanup can delete it", async () => {
  const error = new SandboxProviderError("provider", "boot failed");
  error.leftoverId = "sbx9";
  mocks[0]!.mockResolvedValue({ ...fake, create: () => Promise.reject(error) } as never);
  const recorded: string[] = [];
  try {
    await expect(
      gittermProvider.createWorkspace({
        ...config(),
        onProvisioned: async (info) => void recorded.push(info.externalServiceId),
      }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(recorded).toEqual(["sandbox:gitterm:sbx9"]);
  } finally {
    mocks[0]!.mockResolvedValue(fake as never);
  }
});

test("an image the sandbox service doesn't offer is refused before anything is created", async () => {
  const before = created.length;
  await expect(
    gittermProvider.createWorkspace({ ...config(), imageProviderMetadata: {} }),
  ).rejects.toThrow("not available on Gitterm");
  expect(created).toHaveLength(before);
});

/** A transport for `provider` that records what the generic provider asks of it. */
function recorder(
  provider: "daytona" | "e2b" | "vercel" | "boat",
  home: string,
  sandboxHome = home,
) {
  const ran: string[] = [];
  const written = new Map<string, string>();
  const inputs: SandboxCreateInput[] = [];
  const transport = {
    ...fake,
    provider,
    home,
    async create(input: SandboxCreateInput) {
      inputs.push(input);
      return { id: "s1", state: "running" as const, labels: {}, startedAt: null, expiresAt: null };
    },
    async run(_id: string, command: string) {
      ran.push(command);
      const stdout =
        command === "mint-token"
          ? "pairing-token\n"
          : command.includes('"$HOME"')
            ? sandboxHome
            : "";
      return { exitCode: 0, stdout, stderr: "" };
    },
    async writeFile(_id: string, path: string, data: Uint8Array) {
      written.set(path, Buffer.from(data).toString());
    },
    async info(id: string) {
      return {
        id,
        state: "running" as const,
        labels: inputs[0]!.labels,
        startedAt: null,
        expiresAt: null,
      };
    },
    previews: 0,
    async preview(_id: string, port: number) {
      transport.previews++;
      return { url: `https://${port}-session${transport.previews}.example`, headers: {} };
    },
  };
  mocks[0]!.mockResolvedValue(transport as never);
  return { transport, ran, written, inputs };
}

/** The resume script the workspace wrote with a command, decoded. */
const resumeScriptOf = (ran: string[]) => {
  const write = ran.find((command) => command.includes('> "$HOME/.gitterm/resume.sh"'));
  const encoded = write?.match(/printf %s '([A-Za-z0-9+/=]+)'/)?.[1];
  return encoded ? Buffer.from(encoded, "base64").toString() : undefined;
};

test("any provider's transport hosts workspaces, and a resume starts the agent again", async () => {
  const { ran, inputs } = recorder("daytona", "/home/daytona");
  try {
    const provider = new TransportWorkspaceProvider("daytona", {
      label: "Daytona",
    });
    const info = await provider.createWorkspace({
      ...config(),
      // The image's template and the machine profile's options, merged by the caller.
      imageProviderMetadata: {
        daytona: { image: "gitterm-opencode-server:1", resources: { cpu: 4 } },
      },
    });
    expect(inputs[0]).toMatchObject({
      template: "gitterm-opencode-server:1",
      machine: { resources: { cpu: 4 } },
      labels: { gitterm_workspace: "ws1", gitterm_agent_port: "4096" },
    });
    // Only env the agent uses: entrypoint-only keys stay out (Vercel caps env at 4 KiB).
    expect(Object.keys(inputs[0]!.env!).sort()).toEqual(["AGENT_VAR", "USER_VAR"]);
    // Daytona doesn't run a resume command, so the workspace keeps one on disk instead.
    expect(inputs[0]!.resumeCommand).toBeUndefined();
    const script = resumeScriptOf(ran);
    expect(script).toContain("cd '/workspace/app'");
    expect(script).toContain("/dev/tcp/127.0.0.1/4096");
    expect(info.externalServiceId).toBe("sandbox:daytona:s1");

    ran.length = 0;
    expect(
      await withSandboxHandles(provider).resumeWorkspace(info.externalServiceId),
    ).toBeUndefined();
    expect(ran).toEqual(['[ ! -f "$HOME/.gitterm/resume.sh" ] || bash "$HOME/.gitterm/resume.sh"']);
  } finally {
    mocks[0]!.mockResolvedValue(fake as never);
  }
});

test("agent files go to the image's own home, which can differ from the provider's", async () => {
  const { written } = recorder("daytona", "/home/daytona", "/workspace");
  try {
    await new TransportWorkspaceProvider("daytona", {
      label: "Daytona",
    }).createWorkspace({ ...config(), imageProviderMetadata: { daytona: { image: "img" } } });
    expect(written.get("/workspace/.config/agent.json")).toBe("{}");
  } finally {
    mocks[0]!.mockResolvedValue(fake as never);
  }
});

test("an image's setup commands install the agent, except from a project snapshot", async () => {
  const { ran, inputs } = recorder("boat", "/home/user");
  try {
    const provider = new TransportWorkspaceProvider("boat", { label: "Boat" });
    const metadata = { boat: { setupCommands: ["npm install -g @opencode/cli@2"], size: "large" } };
    await provider.createWorkspace({ ...config(), imageProviderMetadata: metadata as never });
    // No image: the provider's own default image, with the agent installed before the clone.
    expect(inputs[0]!.template).toBeUndefined();
    expect(inputs[0]!.machine).toEqual({ size: "large" });
    const install = ran.indexOf("npm install -g @opencode/cli@2");
    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(ran.findIndex((command) => command.includes("git clone")));

    ran.length = 0;
    await provider.createWorkspace({
      ...config(),
      snapshot: "snap1",
      imageProviderMetadata: metadata as never,
    });
    expect(ran).not.toContain("npm install -g @opencode/cli@2");
  } finally {
    mocks[0]!.mockResolvedValue(fake as never);
  }
});

test("E2B's template id is the template, and its SSH variant is not used", async () => {
  const { inputs } = recorder("e2b", "/home/user");
  try {
    await new TransportWorkspaceProvider("e2b", { label: "E2B" }).createWorkspace({
      ...config(),
      imageProviderMetadata: {
        e2b: {
          templateId: "gitterm-opencode-server",
          sshTemplateId: "with-ssh",
          templateSuffix: "-lg",
        },
      },
    });
    expect(inputs[0]!.template).toBe("gitterm-opencode-server");
    expect(inputs[0]!.machine).toEqual({ templateSuffix: "-lg" });
  } finally {
    mocks[0]!.mockResolvedValue(fake as never);
  }
});

test("a Vercel resume returns the agent's new URL, as Vercel's change per session", async () => {
  const { transport } = recorder("vercel", "/home/vercel-sandbox");
  try {
    const provider = new TransportWorkspaceProvider("vercel", {
      label: "Vercel",
    });
    const info = await provider.createWorkspace({
      ...config(),
      imageProviderMetadata: { vercel: { runtime: "node22", vcpus: 2 } },
    });
    expect(info.upstreamUrl).toBe("https://4096-session1.example");
    expect(await withSandboxHandles(provider).resumeWorkspace(info.externalServiceId)).toEqual({
      upstreamUrl: "https://4096-session2.example",
    });
    expect(transport.previews).toBe(2);
  } finally {
    mocks[0]!.mockResolvedValue(fake as never);
  }
});

test("a transport that runs resume commands itself is not sent the script", async () => {
  commands.length = 0;
  await withSandboxHandles(gittermProvider).resumeWorkspace("sandbox:gitterm:sbx1");
  expect(commands).toEqual([]);
});
