import { randomUUID } from "node:crypto";
import { Plugin } from "@opencode/plugin";
import { OpenCode, type OpenCodeClient } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { createGittermClient } from "@gitterm/sdk";
import {
  handoffSession,
  HandoffCancelled,
  markCloudSession,
  sendToCloud,
  showConnection,
  type HandoffOptions,
  type HandoffRecord,
} from "./handoff";
import { CLOUD_KEY, CLOUD_RPC, type CloudProgress } from "./marker";
import { confirmLocalPrompt, endWorkspace, returnSession } from "./return";
import { checkoutRoot } from "./snapshot";
import { deleteLeftover, watchCloudSessions, workspaceGone } from "./status";

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
    const options = ctx.options as HandoffOptions;
    const controller = new AbortController();
    const busy = new Set<string>();
    const load = async (sessionID: string) =>
      (await ctx.storage.get(sessionKey(sessionID))) as HandoffRecord | undefined;
    const gitterm = () =>
      createGittermClient({ serverUrl: options.serverUrl, token: options.token });

    // The sessions of this checkout that live in the cloud. /cloud-return is only offered
    // while there is one, and what their cloud side is doing is kept on the session.
    const here = await checkoutRoot(ctx.location.directory).catch(() => undefined);
    const inCloud = new Map<string, HandoffRecord>();
    let after: string | undefined;
    do {
      const page = await ctx.storage.scan({ prefix: sessionKey(""), after });
      for (const { value } of page.entries) {
        const record = value as HandoffRecord;
        if (record.phase === "ready" && record.sourceDirectory === here)
          inCloud.set(record.sessionID, record);
      }
      after = page.next;
    } while (after);

    let watching = false;
    // Ends the watcher's wait early, so a session that just moved to the cloud is looked at
    // straight away.
    let wake = () => {};
    const watch = () => {
      wake();
      if (watching || inCloud.size === 0) return;
      watching = true;
      void watchCloudSessions({
        gitterm,
        local: () => localClient(options),
        sessions: () => [...inCloud.values()],
        busy: (sessionID) => busy.has(sessionID),
        // Nothing is left to return from: the session is no longer in the cloud.
        gone: (record) => save({ ...record, phase: "returned" }),
        signal: controller.signal,
        pause: (milliseconds) =>
          new Promise((resolve) => {
            const timer = setTimeout(resolve, milliseconds);
            wake = () => {
              clearTimeout(timer);
              resolve();
            };
            controller.signal.addEventListener("abort", wake, { once: true });
          }),
      })
        .catch((error) => console.error("GitTerm cloud status watcher stopped", error))
        .finally(() => {
          watching = false;
        });
    };
    const save = async (record: HandoffRecord) => {
      // Snapshot contents and access credentials never enter plugin storage.
      await ctx.storage.set(sessionKey(record.sessionID), { ...record });
      const offered = inCloud.size > 0;
      if (record.phase === "ready" && record.sourceDirectory === here)
        inCloud.set(record.sessionID, record);
      else inCloud.delete(record.sessionID);
      // OpenCode lists commands per project, not per session.
      if (inCloud.size > 0 !== offered) await ctx.command.reload().catch(() => {});
      watch();
    };

    const discard = (record: HandoffRecord) => ctx.storage.remove(sessionKey(record.sessionID));

    // The terminal plugin shows each step of a run and can cancel it, through this channel.
    const runs = new Map<string, AbortController>();
    const rpc = await ctx.rpc.register(CLOUD_RPC, {
      cancel: async (input) => {
        const { attemptID } = input as { sessionID: string; attemptID: string };
        const run = runs.get(attemptID);
        run?.abort();
        return { cancelled: Boolean(run) };
      },
    });

    const CANCELLED = Symbol("cancelled");
    const TO_CLOUD = { title: "Moving to the cloud", cancellable: true };
    async function withProgress<T>(
      sessionID: string,
      dialog: { title: string; cancellable: boolean },
      work: (progress: (step: string) => Promise<void>, signal: AbortSignal) => Promise<T>,
    ): Promise<T | typeof CANCELLED> {
      const attemptID = randomUUID();
      const cancel = new AbortController();
      runs.set(attemptID, cancel);
      const signal = AbortSignal.any([controller.signal, cancel.signal]);
      // No step ends the run. The key is left out: RPC rejects a property set to undefined.
      const report = (step: string | undefined) =>
        rpc.events
          .emit("progress", {
            sessionID,
            attemptID,
            ...dialog,
            ...(step === undefined ? {} : { step }),
          } satisfies CloudProgress)
          .catch((error) => console.error("GitTerm cloud progress was not sent", error));
      try {
        return await work(report, signal);
      } catch (error) {
        if (cancel.signal.aborted) return CANCELLED;
        throw error;
      } finally {
        runs.delete(attemptID);
        await report(undefined);
      }
    }

    await ctx.command.transform((editor) => {
      editor.add({
        name: "cloud",
        description:
          "Continue in a GitTerm cloud workspace (billed while it runs). Text after it is sent there",
        async execute({ sessionID, prompt }) {
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
                "/cloud can't reach the OpenCode server holding this session (opencode --standalone uses a private one). Run `opencode serve --port 4096`, open it with `opencode --server http://127.0.0.1:4096`, and set the plugin's localServerUrl to that address.",
              );
            }
            const client = gitterm();
            const message = prompt.text.trim();
            const previous = await load(sessionID);
            if (
              previous?.phase === "ready" &&
              !(await workspaceGone(client, previous.workspaceID!))
            ) {
              const woken = await withProgress(sessionID, TO_CLOUD, (progress, signal) =>
                progress("Starting the cloud workspace").then(async () => {
                  await client.workspaces.ensureRunning(previous.workspaceID!, { signal });
                  if (message) await sendToCloud(client, previous, message, signal);
                }),
              );
              if (woken === CANCELLED) return;
              await showConnection(local, client, previous, controller.signal, Boolean(message));
              return;
            }
            // OpenCode closed during an earlier /cloud: delete what it left before starting over.
            if (previous && previous.phase !== "ready" && previous.phase !== "returned")
              await deleteLeftover(client, previous);
            // Validate login before capture or billable provisioning.
            await client.auth.status();
            const moved = await withProgress(sessionID, TO_CLOUD, (progress, signal) =>
              handoffSession(
                sessionID,
                { local, gitterm: client, options, signal, save, discard, progress },
                message,
              ),
            );
            if (moved === CANCELLED) return;
            await showConnection(local, client, moved.record, controller.signal, moved.continuing);
          } catch (error) {
            if (!(error instanceof HandoffCancelled)) throw error;
          } finally {
            busy.delete(sessionID);
          }
        },
      });
      if (inCloud.size === 0) return;
      editor.add({
        name: "cloud-return",
        description: "Bring this session and its changes back from its GitTerm cloud workspace",
        async execute({ sessionID }) {
          if (busy.has(sessionID))
            throw new Error("A cloud handoff is already in progress for this session.");
          busy.add(sessionID);
          try {
            const previous = await load(sessionID);
            if (previous?.phase !== "ready")
              throw new Error(
                "This session is not in a cloud workspace. Run /cloud to move it there.",
              );
            const local = await localClient(options);
            const client = gitterm();
            // Once the checkout is being replaced, stopping halfway would leave it and the
            // conversation out of step, so Esc only hides the dialog.
            await withProgress(
              sessionID,
              { title: "Bringing it back from the cloud", cancellable: false },
              async (progress, signal) => {
                const { record, end } = await returnSession(previous, {
                  local,
                  gitterm: client,
                  signal,
                  save,
                  progress,
                });
                await progress(
                  end === "pause"
                    ? "Pausing the cloud workspace"
                    : end === "snapshot"
                      ? "Saving the snapshot and deleting the cloud workspace"
                      : "Deleting the cloud workspace",
                );
                await endWorkspace(client, record.workspaceID!, end);
              },
            );
          } catch (error) {
            if (!(error instanceof HandoffCancelled)) throw error;
          } finally {
            busy.delete(sessionID);
          }
        },
      });
    });

    // While a session lives in the cloud, a message sent here would fork the conversation.
    // Ask first. /cloud and /cloud-return are commands and do not pass through this hook.
    await ctx.session.hook("prompt", async ({ sessionID }) => {
      const record = await load(sessionID).catch(() => undefined);
      if (record?.phase !== "ready" || busy.has(sessionID)) return;
      // If the question cannot be asked, let the message through rather than lock the session.
      const local = await localClient(options).catch(() => undefined);
      if (!local) return;
      await confirmLocalPrompt(local, record, controller.signal);
    });

    // A fork copies the session's metadata, but only the original lives in the cloud.
    await ctx.session.hook("fork", async ({ sessionID }) => {
      const local = await localClient(options);
      const { metadata } = await local.session.get({ sessionID }, { signal: controller.signal });
      if (metadata?.[CLOUD_KEY])
        await markCloudSession(local, sessionID, undefined, controller.signal);
    });
    watch();
    return async () => {
      controller.abort();
    };
  },
});

export default GittermCloudPlugin;
