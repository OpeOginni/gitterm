import { expect, test } from "bun:test";
import { openStatusLine, WORKING } from "./status.js";
import type { ChatAdapter } from "./types.js";

const thread = { channel: "C1", thread: "1.0" };
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test("a slow status update can't land after the final line", async () => {
  const sent: string[] = [];
  let calls = 0;
  const adapter = {
    async indicate(_thread: unknown, text: string) {
      // The first update after opening is slow to reach the platform.
      if (++calls === 2) await tick();
      sent.push(`indicate:${text}`);
      return true;
    },
    async post(_thread: unknown, text: string) {
      sent.push(`post:${text}`);
      return "m1";
    },
  } as unknown as ChatAdapter;

  const status = await openStatusLine(adapter, thread);
  status.set({ message: "Creating a sandbox…", indicator: "is creating a sandbox…" });
  await status.finish("Something went wrong");

  expect(sent).toEqual([
    `indicate:${WORKING.indicator}`,
    "indicate:is creating a sandbox…",
    "indicate:",
    "post:Something went wrong",
  ]);
});

test("with a status message, the final edit is the last one", async () => {
  const edits: string[] = [];
  let calls = 0;
  const adapter = {
    async post() {
      return "m1";
    },
    async edit(_thread: unknown, _id: string, text: string) {
      if (++calls === 1) await tick();
      edits.push(text);
    },
  } as unknown as ChatAdapter;

  const status = await openStatusLine(adapter, thread);
  status.set({ message: "Creating a sandbox…", indicator: "is creating a sandbox…" });
  await status.finish("Something went wrong");

  expect(edits).toEqual(["Creating a sandbox…", "Something went wrong"]);
});
