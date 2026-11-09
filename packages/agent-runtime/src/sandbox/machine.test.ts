import { afterAll, expect, mock, spyOn, test } from "bun:test";

/** A managed sandbox's machine profile reaches each provider's create call. */
const calls: unknown[] = [];
const stop = (args: unknown) => {
  calls.push(args);
  throw new Error("stop after create");
};

const e2b = await import("e2b");
mock.module("e2b", () => ({
  ...e2b,
  Sandbox: { create: (template: string) => stop(template) },
}));
const daytona = await import("@daytonaio/sdk");
mock.module("@daytonaio/sdk", () => ({
  ...daytona,
  Daytona: class {
    create(params: unknown) {
      return stop(params);
    }
  },
}));
const vercel = await import("@vercel/sandbox");
mock.module("@vercel/sandbox", () => ({
  ...vercel,
  Sandbox: { create: (params: unknown) => stop(params) },
}));
const boat = await import("@asciidev/box-sdk");
mock.module("@asciidev/box-sdk", () => ({
  ...boat,
  BoxApi: class {
    create(params: unknown) {
      return stop(params);
    }
  },
}));
const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
  _url: string,
  init: RequestInit,
) => {
  calls.push(init.body);
  return new Response("stop", { status: 500 });
}) as never);
afterAll(() => fetchSpy.mockRestore());

const { createSandboxTransport } = await import("./index");

async function created(transport: ReturnType<typeof createSandboxTransport>, machine: object) {
  calls.length = 0;
  await expect(
    transport.create({
      labels: {},
      timeoutMs: 600_000,
      onTimeout: "pause",
      machine: { ...machine },
    }),
  ).rejects.toThrow();
  return calls[0];
}

test("E2B uses the template built for the size", async () => {
  const transport = createSandboxTransport({ provider: "e2b", apiKey: "k" });
  calls.length = 0;
  await expect(
    transport.create({
      labels: {},
      timeoutMs: 600_000,
      template: "gitterm-sandbox",
      machine: { templateSuffix: "-sm" },
    }),
  ).rejects.toThrow();
  expect(calls[0]).toBe("gitterm-sandbox-sm");
});

test("Daytona requests the profile's resources", async () => {
  const transport = createSandboxTransport({ provider: "daytona", apiKey: "k" });
  expect(await created(transport, { resources: { cpu: 1, memory: 2 } })).toMatchObject({
    resources: { cpu: 1, memory: 2 },
  });
});

test("Vercel requests the profile's vCPUs", async () => {
  const transport = createSandboxTransport({
    provider: "vercel",
    apiKey: "k",
    teamId: "t",
    projectId: "p",
  });
  expect(await created(transport, { vcpus: 1 })).toMatchObject({ resources: { vcpus: 1 } });
});

test("Boat requests the profile's box size", async () => {
  const transport = createSandboxTransport({ provider: "boat", apiKey: "k" });
  expect(await created(transport, { size: "small" })).toMatchObject({
    createBoxRequest: { type: "small" },
  });
});

test("exe.dev requests the profile's CPU, memory, and disk", async () => {
  const transport = createSandboxTransport({ provider: "exedev", apiKey: "k" });
  expect(await created(transport, { cpu: 1, memory: "2GB", disk: "20GB" })).toContain(
    "--cpu='1' --memory='2GB' --disk='20GB'",
  );
});
