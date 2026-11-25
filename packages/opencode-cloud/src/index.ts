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
} from "./handoff";
import { CLOUD_KEY, CLOUD_RPC, type CloudProgress } from "./marker";
import { confirmLocalPrompt, endWorkspace, returnSession } from "./return";
import { suggestModels, signedIn } from "./signin";
import { opencodeAgent } from "@gitterm/move/agents/opencode";
import { checkoutRoot } from "@gitterm/move/checkout/snapshot";
import { cloudWentOn } from "@gitterm/move/flows";
import { loadRecords, saveRecord, type MoveRecord } from "@gitterm/move/records";
import { watchCloudSessions, workspaceGone } from "./status";

/**
 * The OpenCode sessions in the cloud, from GitTerm's move records: the same ones the CLI reads
 * and writes, so a session moved either way is known to both.
 */
const openMoves = async () =>
  (await loadRecords()).filter(
    (record) => record.agent === opencodeAgent.key && !record.returnedAt,
  );

/** The session's move, the latest if there are several. */
const moveOf = async (sessionID: string) =>
  (await openMoves()).findLast((record) => record.localRef === sessionID);

/** Closes the record of a move whose workspace was deleted: there is nothing to return. */
const closeMove = (record: MoveRecord) =>
  saveRecord({ ...record, returnedAt: new Date().toISOString() });

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

/** The oldest OpenCode with every API /cloud uses, such as the session fork hook. */
const MINIMUM_OPENCODE = "2.3.0";

async function assertSupported(local: OpenCodeClient, signal: AbortSignal) {
  const { version } = await local.server.info({ signal });
  const [major = 0, minor = 0] = version.split(".").map(Number);
  // A development build has no number to compare.
  if (Number.isNaN(major) || Number.isNaN(minor)) return;
  if (major < 2 || (major === 2 && minor < 3))
    throw new Error(
      `GitTerm cloud needs OpenCode ${MINIMUM_OPENCODE} or newer, and this is ${version}. Run \`opencode upgrade\`, then restart OpenCode.`,
    );
}

export const GittermCloudPlugin = Plugin.define({
  id: "gitterm.cloud",
  async setup(ctx) {
    const options = ctx.options as HandoffOptions;
    const controller = new AbortController();
    const busy = new Set<string>();
    const gitterm = () =>
      createGittermClient({ serverUrl: options.serverUrl, token: options.token });

    // The sessions of this checkout that live in the cloud: what their cloud side is doing is
    // kept on the session.
    const here = await checkoutRoot(ctx.location.directory).catch(() => undefined);
    const movedHere = async () =>
      (await openMoves()).filter((record) => here !== undefined && record.root === here);
    let inCloud = await movedHere();

    let watching = false;
    // Ends the watcher's wait early, so a session that just moved to the cloud is looked at
    // straight away.
    let wake = () => {};
    const watch = () => {
      wake();
      if (watching || inCloud.length === 0) return;
      watching = true;
      void watchCloudSessions({
        gitterm,
        local: () => localClient(options),
        sessions: () => inCloud,
        busy: (sessionID) => busy.has(sessionID),
        // Nothing is left to return from: the session is no longer in the cloud.
        gone: (record) => closeMove(record).then(refresh),
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
    // Read again after each command and before each prompt, so a move made from the CLI is
    // watched too.
    const refresh = async () => {
      inCloud = await movedHere();
      watch();
    };

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
            await assertSupported(local, controller.signal);
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
            // Signs the user in first if they are not, before anything is captured or billed.
            const client = await signedIn(local, sessionID, options, controller.signal);
            const message = prompt.text.trim();
            const previous = await moveOf(sessionID);
            if (previous && !(await workspaceGone(client, previous.workspaceId))) {
              const woken = await withProgress(sessionID, TO_CLOUD, (progress, signal) =>
                progress("Starting the cloud workspace").then(async () => {
                  await client.workspaces.ensureRunning(previous.workspaceId, { signal });
                  if (message) await sendToCloud(client, previous, message, signal);
                }),
              );
              if (woken === CANCELLED) return;
              await showConnection(
                local,
                client,
                sessionID,
                previous.workspaceId,
                controller.signal,
                Boolean(message),
              );
              return;
            }
            if (previous) await closeMove(previous);
            await suggestModels(local, client, sessionID, controller.signal);
            const moved = await withProgress(sessionID, TO_CLOUD, (progress, signal) =>
              handoffSession(
                sessionID,
                { local, gitterm: client, options, signal, progress },
                message,
              ),
            );
            if (moved === CANCELLED) return;
            await refresh();
            // The cloud agent carries on with the task (or the text after /cloud) once it is there.
            await showConnection(
              local,
              client,
              sessionID,
              moved.workspaceID,
              controller.signal,
              true,
            );
          } catch (error) {
            if (!(error instanceof HandoffCancelled)) throw error;
          } finally {
            busy.delete(sessionID);
          }
        },
      });
      // Always offered: commands are listed once per project, and a session may move (from the
      // CLI too) after that. The move is looked up when it runs.
      editor.add({
        name: "cloud-return",
        description: "Bring this session and its changes back from its GitTerm cloud workspace",
        async execute({ sessionID }) {
          if (busy.has(sessionID))
            throw new Error("A cloud handoff is already in progress for this session.");
          busy.add(sessionID);
          try {
            const previous = await moveOf(sessionID);
            if (!previous)
              throw new Error(
                "This session is not in a cloud workspace. Run /cloud to move it there.",
              );
            const local = await localClient(options);
            await assertSupported(local, controller.signal);
            const client = await signedIn(local, sessionID, options, controller.signal);
            // Once the checkout is being replaced, stopping halfway would leave it and the
            // conversation out of step, so Esc only hides the dialog.
            await withProgress(
              sessionID,
              { title: "Bringing it back from the cloud", cancellable: false },
              async (progress, signal) => {
                const { end, cloudUnchanged } = await returnSession(previous, {
                  local,
                  gitterm: client,
                  signal,
                  progress,
                });
                // Ending it now would take anything the cloud session did since it was copied.
                if (!(await cloudUnchanged())) throw new Error(cloudWentOn(previous.workspaceId));
                await progress(
                  end === "pause"
                    ? "Pausing the cloud workspace"
                    : end === "snapshot"
                      ? "Saving the snapshot and deleting the cloud workspace"
                      : "Deleting the cloud workspace",
                );
                await endWorkspace(client, previous.workspaceId, end);
              },
            );
          } catch (error) {
            if (!(error instanceof HandoffCancelled)) throw error;
          } finally {
            busy.delete(sessionID);
            await refresh().catch(() => {});
          }
        },
      });
    });

    // While a session lives in the cloud, a message sent here would fork the conversation.
    // Ask first. /cloud and /cloud-return are commands and do not pass through this hook.
    await ctx.session.hook("prompt", async ({ sessionID }) => {
      await refresh().catch(() => {});
      const record = await moveOf(sessionID).catch(() => undefined);
      if (!record || busy.has(sessionID)) return;
      // If the question cannot be asked, let the message through rather than lock the session.
      const local = await localClient(options).catch(() => undefined);
      if (!local) return;
      await confirmLocalPrompt(local, record, controller.signal);
    });

    // A fork copies the session's metadata, but only the original lives in the cloud.
    // Older OpenCode has no fork hook: still load, so /cloud can say to upgrade.
    await ctx.session
      .hook("fork", async ({ sessionID }) => {
        const local = await localClient(options);
        const { metadata } = await local.session.get({ sessionID }, { signal: controller.signal });
        if (metadata?.[CLOUD_KEY])
          await markCloudSession(local, sessionID, undefined, controller.signal);
      })
      .catch((error) => console.error("GitTerm cloud: OpenCode has no session fork hook", error));
    watch();
    return async () => {
      controller.abort();
    };
  },
});

export default GittermCloudPlugin;
