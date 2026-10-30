import type { ComputeProvider, WorkspaceStatusResult } from "./compute";
import { destroyAndConfirm } from "@gitterm/agent-runtime/sandbox/types";
import { managedSandboxTransport, parseSandboxHandle } from "../service/sandbox-transport";

/**
 * Managed sandboxes are workspace rows whose `externalInstanceId` is a
 * `sandbox:<provider>:<id>` handle. Lifecycle code (termination queue, idle reaper,
 * restart, activity keep-alive, status reconcile) calls the cloud provider's
 * ComputeProvider with that handle; this wrapper sends those calls to the sandbox
 * transport instead, so every existing caller works unchanged.
 */
export function withSandboxHandles(
  provider: ComputeProvider,
  cloudProviderId?: string,
): ComputeProvider {
  const transportFor = async (handle: string) => {
    const parsed = parseSandboxHandle(handle);
    return parsed
      ? {
          transport: await managedSandboxTransport(parsed.provider, cloudProviderId),
          id: parsed.id,
        }
      : null;
  };
  return new Proxy(provider, {
    get(target, property, receiver) {
      const original = Reflect.get(target, property, receiver);
      switch (property) {
        case "terminateWorkspace":
          return async (externalId: string, ...rest: unknown[]) => {
            const sandbox = await transportFor(externalId);
            if (!sandbox) return original.call(target, externalId, ...rest);
            // Cleanup clears the handle after this returns, so it must mean "gone".
            await destroyAndConfirm(sandbox.transport, sandbox.id);
          };
        case "pauseWorkspace":
          return async (externalId: string, ...rest: unknown[]) => {
            const sandbox = await transportFor(externalId);
            if (!sandbox) return original.call(target, externalId, ...rest);
            await sandbox.transport.pause(sandbox.id);
          };
        case "resumeWorkspace":
          return async (externalId: string, ...rest: unknown[]) => {
            const sandbox = await transportFor(externalId);
            if (!sandbox) return original.call(target, externalId, ...rest);
            await sandbox.transport.resume(sandbox.id);
          };
        case "getStatus":
          return async (externalId: string): Promise<WorkspaceStatusResult> => {
            const sandbox = await transportFor(externalId);
            if (!sandbox) return original.call(target, externalId);
            const { state } = await sandbox.transport.info(sandbox.id);
            return { status: state };
          };
        case "keepAliveWorkspace":
          return async (externalId: string, timeoutMs: number) => {
            const sandbox = await transportFor(externalId);
            if (!sandbox) return original?.call(target, externalId, timeoutMs);
            await sandbox.transport.keepAlive?.(sandbox.id, timeoutMs);
          };
        case "execCommand":
          return async (externalId: string, command: string) => {
            const sandbox = await transportFor(externalId);
            if (!sandbox) return original?.call(target, externalId, command);
            return sandbox.transport.run(sandbox.id, command);
          };
        default:
          return original;
      }
    },
  });
}
