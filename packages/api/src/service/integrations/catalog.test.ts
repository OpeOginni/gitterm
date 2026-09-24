import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { db } from "@gitterm/db";
import { integrationPolicy } from "./catalog";

afterEach(() => mock.restore());

function settings(row?: { enabled: boolean; allowPersonal: boolean; allowShared: boolean }) {
  spyOn(db, "select").mockReturnValue({
    from: () => ({ where: async () => (row ? [row] : []) }),
  } as any);
}

test("new integrations require admin enablement", async () => {
  settings();
  expect((await integrationPolicy("google")).enabled).toBe(false);
  expect((await integrationPolicy("github")).enabled).toBe(false);
  expect((await integrationPolicy("executor")).enabled).toBe(false);
});

test("planned connectors remain unavailable even when settings enable them", async () => {
  settings({ enabled: true, allowPersonal: true, allowShared: true });
  expect((await integrationPolicy("executor")).enabled).toBe(false);
  expect((await integrationPolicy("gitlab")).enabled).toBe(false);
  expect((await integrationPolicy("google")).enabled).toBe(true);
});
