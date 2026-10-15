import { expect, spyOn, test } from "bun:test";
import { getLatestT3Version } from "./t3-version";

test("T3 resolves latest and explicit pins from the npm package being installed", async () => {
  const fetch = spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ version: "0.0.45" }))
    .mockResolvedValueOnce(Response.json({ version: "0.0.45" }));
  try {
    expect(await getLatestT3Version("latest")).toBe("0.0.45");
    expect(fetch.mock.calls[0]?.[0]).toBe("https://registry.npmjs.org/t3/latest");
    expect(await getLatestT3Version("v0.0.45")).toBe("0.0.45");
    expect(fetch.mock.calls[1]?.[0]).toBe("https://registry.npmjs.org/t3/0.0.45");
  } finally {
    fetch.mockRestore();
  }
});

test("T3 rejects invalid pins and unresolved registry responses", async () => {
  for (const pin of ["../other", "^0", "0.0.45;exit", "0.0.45-nightly"]) {
    await expect(getLatestT3Version(pin)).rejects.toThrow("exact stable semver");
  }
  const fetch = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ version: "0.0.46" }));
  try {
    await expect(getLatestT3Version("0.0.45")).rejects.toThrow("published stable");
    fetch.mockResolvedValue(new Response("", { status: 404 }));
    await expect(getLatestT3Version("0.0.45")).rejects.toThrow("404");
  } finally {
    fetch.mockRestore();
  }
});
