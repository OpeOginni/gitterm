import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { OpenCode, type OpenCodeClient } from "@opencode/client";
import {
  conversationDigest,
  importPayload,
  offersModel,
  runtimeClient,
  sessionBusy,
  sessionRevision,
  stopSession,
  tellMoved,
} from "./opencode-session.js";
import { localMachine, remoteMachine, type Exec, type Machine } from "../machine.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runs, type AgentAdapter, type ExportedSession, type SessionOps } from "./types.js";

/** GitTerm's OpenCode plugin: `/cloud` and `/cloud-return` in OpenCode itself. */
const PLUGIN = "@gitterm/opencode";
/** The two plugins @gitterm/opencode replaced: both at once would add /cloud twice. */
const REPLACED = ["@gitterm/opencode-cloud", "@gitterm/opencode-sandbox"];

/** OpenCode's global config, as text: where `opencode plugin add` puts plugins. */
async function globalConfig(): Promise<string> {
  const dir = path.join(
    process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || homedir(), ".config"),
    "opencode",
  );
  const texts = await Promise.all(
    ["opencode.json", "opencode.jsonc"].map((name) =>
      readFile(path.join(dir, name), "utf8").catch(() => ""),
    ),
  );
  return texts.join("\n");
}

type Exported = Awaited<ReturnType<OpenCodeClient["session"]["export"]>>;

/** A machine whose OpenCode server the adapter reaches; this machine's is found when absent. */
type OpenCodeMachine = Machine & { opencode?: OpenCodeClient };

const signal = () => AbortSignal.timeout(120_000);

/**
 * This machine's OpenCode: the background server OpenCode's CLI registers in
 * `<XDG state>/opencode/service.json` (GITTERM_OPENCODE_URL and _PASSWORD override it).
 */
async function localClient(): Promise<OpenCodeClient> {
  let url = process.env.GITTERM_OPENCODE_URL;
  let password = process.env.GITTERM_OPENCODE_PASSWORD;
  if (!url) {
    const state =
      process.env.XDG_STATE_HOME || path.join(process.env.HOME || homedir(), ".local", "state");
    const service = JSON.parse(
      await readFile(path.join(state, "opencode", "service.json"), "utf8").catch(() => {
        throw new Error("OpenCode is not running on this machine. Start it, then try again.");
      }),
    ) as { url: string; password?: string };
    url = service.url;
    password = service.password;
  }
  return OpenCode.make({
    baseUrl: url,
    ...(password
      ? {
          headers: {
            authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
          },
        }
      : {}),
  });
}

/** Runs one command through an OpenCode server's shell, as GitTerm's command endpoint would. */
export function opencodeExec(client: OpenCodeClient, directory: string): Exec {
  return async (command) => {
    const location = { directory };
    let shell = (await client.shell.create({ location, cwd: directory, command, timeout: 300_000 }))
      .data;
    while (shell.status === "running") {
      await delay(200);
      shell = (await client.shell.get({ id: shell.id, location })).data;
    }
    let stdout = "";
    for (let cursor = 0; ; ) {
      const page = (await client.shell.output({ id: shell.id, location, cursor })).data;
      stdout += page.output;
      if (page.cursor <= cursor || page.cursor >= page.size) break;
      cursor = page.cursor;
    }
    await client.shell.remove({ id: shell.id, location }).catch(() => {});
    return { exitCode: shell.exit ?? 1, stdout };
  };
}

/** Whether `next` is `previous` with messages added, ignoring agent and model switches. */
function continues(
  previous: ReadonlyArray<{ type: string }>,
  next: ReadonlyArray<{ type: string }>,
): boolean {
  const said = (messages: ReadonlyArray<{ type: string }>) =>
    messages.filter((item) => item.type !== "agent-switched" && item.type !== "model-switched");
  const before = said(previous);
  return conversationDigest(before) === conversationDigest(said(next).slice(0, before.length));
}

function sessionOps(machine: OpenCodeMachine): SessionOps {
  const client = () => (machine.opencode ? Promise.resolve(machine.opencode) : localClient());
  return {
    async info() {
      return { version: (await (await client()).server.info({ signal: signal() })).version };
    },

    async export({ ref, allowBusy }) {
      const opencode = await client();
      if (!allowBusy && (await sessionBusy(opencode, ref, signal())))
        throw new Error("The session is still working. Let it finish or stop it, then try again.");
      const session = await opencode.session.get({ sessionID: ref }, { signal: signal() });
      const exported = await opencode.session.export({ sessionID: ref }, { signal: signal() });
      return {
        ref,
        cwd: session.location.directory,
        title: session.title ?? "",
        mark: exported.messages.length,
        payload: exported as unknown as Record<string, unknown>,
      };
    },

    /**
     * OpenCode keeps a session's id when it imports one, and refuses an id it has, so a replaced
     * session is removed first. A fork of it stays until the import is read back whole (and for
     * good when it has messages the incoming one lacks), or until a failed import is put back as
     * it was and read back whole too.
     */
    async import({ payload, cwd, ref }) {
      const opencode = await client();
      const exported = payload as unknown as Exported;
      const model = exported.info.model;
      const keepModel = model
        ? await offersModel(opencode, cwd, model, signal()).catch(() => false)
        : false;
      if (!ref)
        return {
          ref: (
            await opencode.session.import(importPayload(exported, cwd, { keepModel }), {
              signal: signal(),
            })
          ).id,
        };
      type Payload = Parameters<OpenCodeClient["session"]["import"]>[0];
      // Read back before the copy that could replace it is let go.
      const importWhole = async (payload: Payload, messages: Exported["messages"]) => {
        const { id } = await opencode.session.import(payload, { signal: signal() });
        const back = await opencode.session.export({ sessionID: id }, { signal: signal() });
        if (!continues(messages, back.messages))
          throw new Error("OpenCode did not import the whole conversation.");
        return id;
      };
      const current = await opencode.session.export({ sessionID: ref }, { signal: signal() });
      // OpenCode refuses to fork an empty session, which has nothing to lose anyway.
      const copy = current.messages.length
        ? await opencode.session.fork({ sessionID: ref }, { signal: signal() })
        : undefined;
      const dropCopy = async () => {
        if (copy)
          await opencode.session
            .remove({ sessionID: copy.id }, { signal: signal() })
            .catch(() => {});
      };
      const keepCopy = !continues(current.messages, exported.messages);
      await opencode.session.remove({ sessionID: ref }, { signal: signal() });
      let id: string;
      try {
        id = await importWhole(importPayload(exported, cwd, { keepModel }), exported.messages);
      } catch (error) {
        // Put back as it was, under its own id; a short import there is removed first.
        const restored = await opencode.session
          .remove({ sessionID: ref }, { signal: signal() })
          .catch(() => {})
          .then(() =>
            importWhole(
              { ...current, location: current.info.location } as Payload,
              current.messages,
            ),
          )
          .then(
            () => true,
            () => false,
          );
        if (restored && !keepCopy) await dropCopy();
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          restored || !copy
            ? reason
            : `${reason} The session it was replacing is kept as ${copy.id} ("${copy.title ?? ""}").`,
          { cause: error },
        );
      }
      if (!keepCopy) await dropCopy();
      return { ref: id };
    },

    /** The notice becomes a session instruction (it outlasts compaction); its last line starts the turn. */
    async notify({ ref, message }) {
      const opencode = await client();
      const lines = message.trim().split("\n");
      const next = lines.pop() ?? "";
      if (lines.some((line) => line.trim())) await tellMoved(opencode, ref, lines, true, signal());
      await opencode.session.synthetic(
        { sessionID: ref, text: next, resume: true },
        { signal: signal() },
      );
    },

    async status({ ref }) {
      return { busy: await sessionBusy(await client(), ref, signal()) };
    },

    async stop({ ref }) {
      return stopSession(await client(), ref, AbortSignal.timeout(30_000));
    },

    async revision({ ref }) {
      return sessionRevision(await client(), ref, signal());
    },
  };
}

export const opencodeAgent: AgentAdapter = {
  key: "opencode",
  label: "OpenCode",
  installed: () => runs("opencode", ["--version"]),
  howToMove: "Type /cloud in a session; /cloud-return brings it back.",
  /** Installs GitTerm's plugin into OpenCode's global configuration; again is harmless. */
  async setup() {
    const added = await promisify(execFile)("opencode", ["plugin", "add", PLUGIN], {
      timeout: 180_000,
    }).catch((error: { stderr?: string; message: string }) => {
      const reason = (error.stderr || error.message).trim().split("\n").at(-1);
      throw new Error(`opencode plugin add ${PLUGIN} failed: ${reason}`);
    });
    // Their options (a provider key, a server) are the user's: say what to do, change nothing.
    const config = await globalConfig();
    const warnings = REPLACED.filter((name) => config.includes(`"${name}"`)).map(
      (name) =>
        `${name} is still in your OpenCode config, and ${PLUGIN} replaces it. Move its options to ${PLUGIN}${name.endsWith("sandbox") ? ' under "sandbox"' : ""}, then run: opencode plugin remove ${name}`,
    );
    return {
      changes: [added.stdout.trim().split("\n").at(-1) || `Installed ${PLUGIN}.`],
      warnings,
    };
  },
  // OpenCode gives its shell commands the session they run in.
  currentSession: (env) => env.OPENCODE_SESSION_ID,
  sentSince(exported: ExportedSession, mark: number) {
    const messages = (exported.payload as unknown as Exported).messages as ReadonlyArray<{
      type: string;
    }>;
    return messages.slice(mark).some((message) => message.type === "user");
  },
  session: sessionOps,
  /**
   * The workspace through its OpenCode server, so moving needs no GitTerm command endpoint and
   * works on every provider.
   */
  remote(runtime) {
    const opencode = runtimeClient({
      url: runtime.url,
      directory: runtime.directory,
      headers: runtime.headers,
      password: runtime.password,
    } as Parameters<typeof runtimeClient>[0]);
    return Object.assign(remoteMachine(opencodeExec(opencode, runtime.directory)), { opencode });
  },
};

/** This machine, with its OpenCode server, for tests that point at a particular one. */
export const opencodeMachine = (opencode?: OpenCodeClient): OpenCodeMachine =>
  Object.assign(localMachine(), opencode ? { opencode } : {});
