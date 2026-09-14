import { expect, test } from "bun:test";
import { awsRequestSignal, withAwsRequestDeadline } from "./request-deadline";

test("deadline abort signal reaches AWS and cleanup can run outside it", async () => {
  const options: Array<Record<string, unknown>> = [];
  const client = withAwsRequestDeadline({
    send: async (_command: unknown, option: Record<string, unknown>) => {
      options.push(option);
    },
  });
  const controller = new AbortController();
  await awsRequestSignal.run(controller.signal, async () => {
    await client.send({}, {});
    expect(options[0]?.abortSignal).toBe(controller.signal);
    controller.abort();
    expect(() => client.send({}, {})).toThrow();
    await awsRequestSignal.exit(() => client.send({}, {}));
  });
  expect(options[1]?.abortSignal).toBeUndefined();
});

test("concurrent workspaces do not share cancellation signals", async () => {
  const signals: unknown[] = [];
  const client = withAwsRequestDeadline({
    send: async (_command: unknown, option: Record<string, unknown>) => {
      signals.push(option.abortSignal);
    },
  });
  const first = new AbortController();
  const second = new AbortController();
  await Promise.all(
    [first, second].map((controller) =>
      awsRequestSignal.run(controller.signal, async () => {
        await Promise.resolve();
        await client.send({}, {});
      }),
    ),
  );
  expect(signals).toContain(first.signal);
  expect(signals).toContain(second.signal);
});
