import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { db, type SQL } from "@gitterm/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { Context as HonoContext } from "hono";
import type { Context } from "../../context";
import { router } from "../../index";
import { opencodeConnectionProcedures } from "./opencode-connection";

const opencodeConnectionRouter = router(opencodeConnectionProcedures);

const workspaceId = "d30322f4-4214-47b3-9844-f8267e531933";
const record = {
  id: workspaceId,
  status: "running",
  serverOnly: true,
  subdomain: "workspace",
  serverPassword: "invalid-encrypted-secret",
  image: { agentType: { provisionerKey: "opencode" } },
};
const lookup = spyOn(db.query.workspace, "findFirst");
afterEach(() => lookup.mockReset());
afterAll(() => lookup.mockRestore());

function caller(authenticated = true) {
  const honoContext = new HonoContext(new Request("https://api.example.test/trpc"));
  const context = {
    session: authenticated ? { user: { id: "owner" } } : null,
    honoContext,
  } as unknown as Context;
  return { api: opencodeConnectionRouter.createCaller(context), honoContext };
}

describe("OpenCode connection authorization", () => {
  test("requires a browser session before looking up a workspace", async () => {
    await expect(
      caller(false).api.createOpencodeConnection({ workspaceId, kind: "link" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(lookup).not.toHaveBeenCalled();
  });

  test("filters by owner and workspace, and disables credential response caching", async () => {
    lookup.mockResolvedValue(undefined);
    const { api, honoContext } = caller();
    await expect(api.createOpencodeConnection({ workspaceId, kind: "link" })).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    const query = lookup.mock.calls[0]?.[0] as { where: SQL };
    const sql = new PgDialect().sqlToQuery(query.where);
    expect(sql.sql).toContain('"workspace"."user_id"');
    expect(sql.params).toEqual([workspaceId, "owner"]);
    expect(honoContext.res.headers.get("cache-control")).toBe("no-store, private");
  });

  test("does not issue credentials for other agents", async () => {
    lookup.mockResolvedValue({
      ...record,
      image: { agentType: { provisionerKey: "t3code" } },
    } as never);
    await expect(
      caller().api.createOpencodeConnection({ workspaceId, kind: "link" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test.each(["paused", "pending", "terminated"])("rejects %s workspaces", async (status) => {
    lookup.mockResolvedValue({ ...record, status } as never);
    await expect(
      caller().api.createOpencodeConnection({ workspaceId, kind: "tui" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("rejects missing credentials and non-server workspaces", async () => {
    for (const overrides of [
      { serverPassword: null },
      { subdomain: null },
      { serverOnly: false },
    ]) {
      lookup.mockResolvedValue({ ...record, ...overrides } as never);
      await expect(
        caller().api.createOpencodeConnection({ workspaceId, kind: "link" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  test("does not include decryption details or secrets in client errors", async () => {
    lookup.mockResolvedValue(record as never);
    await expect(
      caller().api.createOpencodeConnection({ workspaceId, kind: "tui" }),
    ).rejects.toMatchObject({
      code: "BAD_GATEWAY",
      message:
        "Could not create an OpenCode connection. Try again, or use the server URL and password.",
    });
  });
});
