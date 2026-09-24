import { expect, test } from "bun:test";
import { adminIntegrationsRouter } from "./integrations";

const request = { key: "google" as const, enabled: true, allowPersonal: true, allowShared: false };

test("only an admin browser session can change deployment integration policy", async () => {
  const anonymous = adminIntegrationsRouter.createCaller({ session: null } as any);
  await expect(anonymous.update(request)).rejects.toMatchObject({ code: "UNAUTHORIZED" });

  const user = adminIntegrationsRouter.createCaller({
    session: { user: { id: "user", role: "user" } },
  } as any);
  await expect(user.update(request)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    user.configureGoogle({ issuer: "https://api.example.com/api/workload-identity" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
