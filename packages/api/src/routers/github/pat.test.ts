import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { db } from "@gitterm/db";
import { githubPatRouter } from "./pat";

afterEach(() => mock.restore());

test("PATs are not readable without authentication", async () => {
  const caller = githubPatRouter.createCaller({ session: null } as any);
  await expect(caller.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(caller.remove({ id: "8dfe2276-8d75-4f7f-8905-485c311d650a" })).rejects.toMatchObject(
    { code: "UNAUTHORIZED" },
  );
});

test("PAT list returns only public metadata, never encrypted token material", async () => {
  let calls = 0;
  spyOn(db, "select").mockImplementation((() => ({
    from: () => ({
      where: async () => {
        calls++;
        return calls === 1
          ? [{ enabled: true, allowPersonal: true, allowShared: false }]
          : [
              {
                id: "pat-id",
                userId: "owner",
                name: "work",
                accountLogin: "dev",
                tokenSuffix: "1234",
                encryptedToken: "encrypted-sensitive-material",
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ];
      },
    }),
  })) as any);
  const caller = githubPatRouter.createCaller({ session: { user: { id: "owner" } } } as any);
  const [result] = await caller.list();
  expect(result).toMatchObject({ id: "pat-id", name: "work", tokenSuffix: "1234" });
  expect(JSON.stringify(result)).not.toContain("encrypted-sensitive-material");
  expect(JSON.stringify(result)).not.toContain("userId");
});
