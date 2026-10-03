import { afterEach, expect, mock, spyOn, test } from "bun:test";
import * as https from "node:https";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { mcpFetch } from "./mcp-network";

afterEach(() => mock.restore());

function responseFixture(status: number, headers: Record<string, string>, chunks: string[]) {
  const response = Readable.from(chunks.map((chunk) => Buffer.from(chunk))) as Readable & {
    statusCode: number;
    headers: Record<string, string>;
    setTimeout: () => void;
  };
  response.statusCode = status;
  response.headers = headers;
  response.setTimeout = () => {};
  return response;
}

test("secure fetch pins the validated address, strips cookies, and streams the response", async () => {
  let outgoing: https.RequestOptions | undefined;
  const chunks: string[] = [];
  spyOn(https, "request").mockImplementation((_url: any, options?: any, callback?: any) => {
    outgoing = options;
    const req = new EventEmitter() as any;
    req.write = (body: string) => chunks.push(body);
    req.end = () =>
      callback(
        responseFixture(
          200,
          { "content-type": "text/event-stream", "set-cookie": "private=value" },
          ["data: first\n\n", "data: second\n\n"],
        ),
      );
    req.destroy = () => {};
    return req;
  });
  const response = await mcpFetch("https://1.1.1.1/mcp", {
    method: "POST",
    headers: {
      Cookie: "browser=secret",
      Authorization: "Bearer upstream",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  expect(outgoing?.agent).toBe(false);
  const headers = outgoing?.headers as Record<string, string>;
  expect(headers.cookie).toBeUndefined();
  expect(headers.authorization).toBe("Bearer upstream");
  let address: unknown;
  (outgoing!.lookup as any)(
    "attacker-rebound.example",
    { all: true },
    (_error: unknown, addresses: unknown) => {
      address = addresses;
    },
  );
  expect(address).toEqual([{ address: "1.1.1.1", family: 4 }]);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(await response.text()).toBe("data: first\n\ndata: second\n\n");
  expect(chunks).toEqual(["{}"]);
});

test("secure fetch never follows a redirect carrying credentials", async () => {
  let requests = 0;
  spyOn(https, "request").mockImplementation((_url: any, _options?: any, callback?: any) => {
    requests++;
    const req = new EventEmitter() as any;
    req.write = () => {};
    req.end = () =>
      callback(responseFixture(302, { location: "https://169.254.169.254/latest/meta-data" }, []));
    req.destroy = () => {};
    return req;
  });
  await expect(
    mcpFetch("https://1.1.1.1/mcp", { headers: { Authorization: "Bearer upstream" } }),
  ).rejects.toThrow("redirected");
  expect(requests).toBe(1);
});

test("invalid upstream HTTP statuses reject instead of escaping the async response callback", async () => {
  const response = responseFixture(600, {}, []);
  spyOn(https, "request").mockImplementation((_url: any, _options?: any, callback?: any) => {
    const req = new EventEmitter() as any;
    req.end = () => queueMicrotask(() => callback(response));
    req.destroy = () => {};
    return req;
  });
  await expect(mcpFetch("https://1.1.1.1/mcp")).rejects.toThrow("invalid HTTP status");
  expect(response.destroyed).toBe(true);
});
