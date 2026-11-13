import { randomUUID } from "node:crypto";
import { Plugin } from "@opencode/plugin";
import { OpenCode, type OpenCodeClient } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { createGittermClient } from "@gitterm/sdk";
import {
  askForm,
  handoffSession,
  HandoffCancelled,
  markCloudSession,
  setSessionMetadata,
  showConnection,
  type HandoffOptions,
  type HandoffRecord,
} from "./handoff";
import { CANCEL_KEY, CLOUD_KEY, PROGRESS_KEY, type CloudProgress } from "./marker";
import { confirmLocalPrompt, finishReturn, returnSession } from "./return";
import { checkoutRoot } from "./snapshot";
import { watchCloudSessions } from "./status";

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
      await ctx.storage.set(`handoff/attempt/${record.attemptID}`, { ...record });
      await ctx.storage.set(sessionKey(record.sessionID), { ...record });
      const offered = inCloud.size > 0;
      if (record.phase === "ready" && record.sourceDirectory === here)
        inCloud.set(record.sessionID, record);
      else inCloud.delete(record.sessionID);
      // OpenCode lists commands per project, not per session.
      if (inCloud.size > 0 !== offered) await ctx.command.reload().catch(() => {});
      watch();
    };

    const CANCELLED = Symbol("cancelled");
    async function withProgress<T>(
      local: OpenCodeClient,
      sessionID: string,
      work: (progress: (step: string) => Promise<void>, signal: AbortSignal) => Promise<T>,
    ): Promise<T | typeof CANCELLED> {
      const attemptID = randomUUID();
      const cancel = new AbortController();
      const signal = AbortSignal.any([controller.signal, cancel.signal]);
      const progress = (step: string) =>
        setSessionMetadata(
          local,
          sessionID,
          { [PROGRESS_KEY]: { attemptID, step } satisfies CloudProgress },
          signal,
        ).catch(() => {});
      const finished = new AbortController();
      const watcher = (async () => {
        for await (const event of ctx.event.subscribe({
          types: ["session.metadata.updated"],
          signal: finished.signal,
        })) {
          if (event.data.sessionID === sessionID && event.data.metadata[CANCEL_KEY] === attemptID)
            return cancel.abort();
        }
      })().catch((error) => {
        if (!finished.signal.aborted) cancel.abort(error);
      });
      try {
        return await work(progress, signal);
      } catch (error) {
        if (cancel.signal.aborted) return CANCELLED;
        throw error;
      } finally {
        finished.abort();
        await watcher;
        await setSessionMetadata(
          local,
          sessionID,
          { [PROGRESS_KEY]: undefined, [CANCEL_KEY]: undefined },
          AbortSignal.timeout(5_000),
        ).catch(() => {});
      }
    }

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
                "/cloud can't reach the OpenCode server holding this session (opencode --standalone uses a private one). Run `opencode serve --port 4096`, open it with `opencode --server http://127.0.0.1:4096`, and set the plugin's localServerUrl to that address.",
              );
            }
            const client = gitterm();
            // A session that came back with /cloud-return starts over.
            const previous = await load(sessionID).then((record) =>
              record?.phase === "returned" ? undefined : record,
            );
            if (previous?.phase === "ready") {
              const woken = await withProgress(local, sessionID, (progress, signal) =>
                progress("Starting the cloud workspace").then(() =>
                  client.workspaces.ensureRunning(previous.workspaceID!, {
                    signal,
                  }),
                ),
              );
              if (woken === CANCELLED) return;
              await showConnection(local, client, previous, controller.signal);
              return;
            }
            let attemptID: string | undefined;
            if (previous) {
              const answer = await askForm(
                local,
                sessionID,
                "The last cloud handoff did not finish. Retry in the same workspace?",
                [
                  {
                    key: "reuse",
                    type: "boolean",
                    title: "Retry in the same cloud workspace?",
                    required: true,
                    description: `Previous attempt: ${previous.attemptID}${previous.workspaceID ? `; workspace: ${previous.workspaceID}` : ""}. Yes retries that attempt, so no second workspace is created. No starts a new workspace: the earlier one is NOT deleted and may keep incurring charges until you remove it in GitTerm.`,
                  },
                ],
                controller.signal,
              );
              if (answer.reuse === true) attemptID = previous.attemptID;
            }
            const reused = attemptID !== undefined;
            const attempt = attemptID ?? randomUUID();
            // Validate login before capture or billable provisioning.
            await client.auth.status();
            const record = await withProgress(local, sessionID, (progress, signal) =>
              handoffSession(
                sessionID,
                { local, gitterm: client, options, signal, save, progress },
                attempt,
              ),
            );
            if (record === CANCELLED) {
              const latest = await load(sessionID);
              if (!reused && latest?.attemptID === attempt) {
                if (latest.workspaceID)
                  await client.workspaces.terminate(latest.workspaceID).catch(() => {
                    throw new Error(
                      `/cloud was cancelled, but workspace ${latest.workspaceID} could not be deleted. Delete it in GitTerm.`,
                    );
                  });
                await ctx.storage.remove(sessionKey(sessionID));
              }
              return;
            }
            await showConnection(local, client, record, controller.signal);
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
            const { record, kept } = await returnSession(previous, {
              local,
              gitterm: client,
              signal: controller.signal,
              save,
              progress: async (text) => {
                console.info(`GitTerm: ${text}`);
              },
            });
            await finishReturn(local, client, record, kept, controller.signal);
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
