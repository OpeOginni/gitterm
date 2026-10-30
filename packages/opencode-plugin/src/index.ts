import { Plugin } from "@opencode/plugin";
import { OpenCode, type OpenCodeClient } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { createGittermClient } from "@gitterm/sdk";
import {
  askForm,
  handoffSession,
  HandoffCancelled,
  showConnection,
  type HandoffOptions,
  type HandoffRecord,
} from "./handoff";
import { registerSandboxTools } from "./sandbox";
import type { SandboxSettings } from "@gitterm/sdk/sandbox";

const sessionKey = (sessionID: string) => `handoff/session/${sessionID}`;

async function localClient(options: HandoffOptions): Promise<OpenCodeClient> {
  const explicit = options.localServerUrl ?? process.env.GITTERM_OPENCODE_LOCAL_SERVER_URL;
  if (explicit) {
    const url = new URL(explicit);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password
    ) {
      throw new Error(
        "localServerUrl must be a loopback OpenCode server URL without embedded credentials.",
      );
    }
    const password =
      options.localServerPassword ?? process.env.GITTERM_OPENCODE_LOCAL_SERVER_PASSWORD;
    return OpenCode.make({
      baseUrl: explicit,
      headers: password
        ? { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` }
        : {},
      fetch: ((input, init) => fetch(input, { ...init, redirect: "error" })) as typeof fetch,
    });
  }
  const endpoint = await Service.discover();
  if (!endpoint)
    throw new Error(
      "Cannot discover this OpenCode service. For standalone/custom servers, set localServerUrl and the optional localServerPassword plugin options.",
    );
  return OpenCode.make({
    baseUrl: endpoint.url,
    headers: Service.headers(endpoint),
    fetch: ((input, init) => fetch(input, { ...init, redirect: "error" })) as typeof fetch,
  });
}

export const GittermCloudPlugin = Plugin.define({
  id: "gitterm.cloud",
  async setup(ctx) {
    const options = ctx.options as HandoffOptions & { sandbox?: SandboxSettings };
    const controller = new AbortController();
    const busy = new Set<string>();
    const load = async (sessionID: string) =>
      (await ctx.storage.get(sessionKey(sessionID))) as HandoffRecord | undefined;
    const save = async (record: HandoffRecord) => {
      // Snapshot contents and access credentials never enter plugin storage.
      await ctx.storage.set(`handoff/attempt/${record.attemptID}`, { ...record });
      await ctx.storage.set(sessionKey(record.sessionID), { ...record });
    };
    const gitterm = () =>
      createGittermClient({ serverUrl: options.serverUrl, token: options.token });

    await ctx.command.transform((editor) => {
      editor.add({
        name: "cloud",
        description: "Continue in GitTerm, or reconnect to this session's existing cloud workspace",
        async execute({ sessionID }) {
          if (busy.has(sessionID))
            throw new Error("A cloud handoff is already in progress for this session.");
          busy.add(sessionID);
          try {
            if (process.env.WORKSPACE_ID)
              throw new Error("This session is already running in a GitTerm workspace.");
            const local = await localClient(options);
            const source = await ctx.session.get({ sessionID });
            const connected = await local.session.get({ sessionID }, { signal: controller.signal });
            if (
              connected.location.directory !== source.location.directory ||
              connected.time.created !== source.time.created
            ) {
              throw new Error(
                "The discovered service is not hosting this session. Configure localServerUrl for the current server.",
              );
            }
            const client = gitterm();
            const previous = await load(sessionID);
            if (previous?.phase === "ready") {
              await showConnection(local, client, previous, controller.signal);
              return;
            }
            if (previous) {
              const answer = await askForm(
                local,
                sessionID,
                "Previous cloud handoff is incomplete",
                [
                  {
                    key: "retry",
                    type: "boolean",
                    title: "Start a new cloud handoff?",
                    default: false,
                    required: true,
                    description: `Previous attempt: ${previous.attemptID}${previous.workspaceID ? `; workspace: ${previous.workspaceID}` : ""}. Check GitTerm first: that workspace may still be running. It will NOT be deleted by retrying, and another workspace may incur additional charges.`,
                  },
                ],
                controller.signal,
              );
              if (answer.retry !== true) throw new HandoffCancelled();
            }
            // Validate login before capture or billable provisioning.
            await client.auth.status();
            const record = await handoffSession(sessionID, {
              local,
              gitterm: client,
              options,
              signal: controller.signal,
              save,
              progress: async (text) => {
                console.info(`GitTerm: ${text}`);
              },
            });
            await showConnection(local, client, record, controller.signal);
          } catch (error) {
            if (!(error instanceof HandoffCancelled)) throw error;
          } finally {
            busy.delete(sessionID);
          }
        },
      });
    });
    const closeSandboxTools = await registerSandboxTools(ctx, options.sandbox);
    return async () => {
      controller.abort();
      await closeSandboxTools();
    };
  },
});

export default GittermCloudPlugin;
