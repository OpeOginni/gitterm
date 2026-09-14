import { AsyncLocalStorage } from "node:async_hooks";

/** Per-attempt context, never mutable state on the shared provider instance. */
export const awsRequestSignal = new AsyncLocalStorage<AbortSignal>();

export function withAwsRequestDeadline<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== "send" || typeof value !== "function") return value;
      const send = value as (command: unknown, options: Record<string, unknown>) => unknown;
      return (command: unknown, options: Record<string, unknown> = {}) => {
        const signal = awsRequestSignal.getStore();
        signal?.throwIfAborted();
        return send.call(target, command, {
          ...options,
          ...(signal ? { abortSignal: signal } : {}),
        });
      };
    },
  });
}
