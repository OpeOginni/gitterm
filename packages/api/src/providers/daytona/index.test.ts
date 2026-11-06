import { describe, expect, spyOn, test } from "bun:test";

describe("Daytona workspace creation", () => {
  test("records the sandbox before setup, so a failed setup is still cleaned up", async () => {
    const { DaytonaProvider } = await import(".");
    const events: string[] = [];
    const failing = (step: string) => async () => {
      events.push(step);
      throw new Error(`${step} failed`);
    };
    const sandbox = {
      id: "daytona-sandbox",
      process: { createSession: failing("setup"), executeCommand: failing("setup") },
      delete: failing("delete"),
    };
    const provider = new DaytonaProvider();
    spyOn(provider, "getConfig").mockResolvedValue({ defaultTargetRegion: "eu" } as never);
    spyOn(provider as any, "createClient").mockResolvedValue({ create: async () => sandbox });
    await expect(
      provider.createWorkspace({
        workspaceId: "ws",
        userId: "user",
        imageId: "image",
        subdomain: "ws",
        onProvisioned: async ({ externalServiceId }) => {
          events.push(`recorded ${externalServiceId}`);
        },
      }),
    ).rejects.toThrow();
    expect(events[0]).toBe("recorded daytona-sandbox");
    expect(events).toContain("setup");
  });
});
