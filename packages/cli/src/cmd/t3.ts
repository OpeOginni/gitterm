import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createGittermClient } from "@gitterm/sdk";
import chalk from "chalk";
import { checkoutRoot, repositoryUrl } from "../../../opencode-cloud/src/snapshot.js";
import { createEnvironment, endEnvironment, moveToCloud, returnFromCloud } from "../t3/flows.js";
import { gittermCloud } from "../t3/gitterm.js";
import { loadRecords, type MoveRecord } from "../t3/local.js";
import { localMachine } from "../t3/machine.js";
import { installSkill } from "../t3/skill.js";
import { handleError, printJson, startSpinner, success } from "../ui.js";

type JsonArgs = { json?: boolean };

/** Progress on stderr, so an agent reading stdout gets only the result. */
function progressReporter(json?: boolean) {
  const spin = startSpinner("Starting", json);
  return {
    progress: (message: string) => {
      if (spin) spin.text = message;
      else if (!json) console.error(chalk.dim(`… ${message}`));
    },
    stop: () => spin?.stop(),
  };
}

export async function runT3Setup(args: JsonArgs) {
  try {
    const local = localMachine();
    const linked = await local.t3<{ changed: boolean }>("enableLinks");
    const skills = await installSkill();
    let signedIn: string | null = null;
    try {
      signedIn = (await createGittermClient().auth.status()).email;
    } catch {
      /* Reported below. */
    }
    if (args.json) return printJson({ linkedEnvironments: true, skills, signedIn });
    success(
      linked.changed
        ? "Turned on Linked environments in T3 Code."
        : "Linked environments are on in T3 Code.",
    );
    success(`Installed the gitterm-cloud skill: ${skills.join(", ")}`);
    if (signedIn) success(`Signed in to GitTerm as ${signedIn}.`);
    else console.log(chalk.yellow("Not signed in to GitTerm: run `gitterm login`."));
    console.log(
      "\nIn a T3 Code thread, ask the agent to move it to the cloud (or type $gitterm-cloud).",
    );
  } catch (err) {
    handleError(err, args.json);
  }
}

export async function runT3Move(
  args: JsonArgs & {
    message?: string;
    thread?: string;
    changes: boolean;
    provider?: string;
    connection?: string[];
  },
) {
  const reporter = progressReporter(args.json);
  try {
    const threadId = args.thread ?? process.env.T3CODE_THREAD_ID;
    if (!threadId) throw new Error("Run this from a T3 Code thread, or pass --thread <thread id>.");
    const result = await moveToCloud(
      {
        cloud: gittermCloud(createGittermClient(), {
          provider: args.provider,
          connections: args.connection,
        }),
        local: localMachine(),
        progress: reporter.progress,
      },
      {
        threadId,
        message: args.message,
        changes: args.changes,
        fromThread: threadId === process.env.T3CODE_THREAD_ID,
      },
    );
    reporter.stop();
    if (args.json) return printJson(result);
    success("Moved to a GitTerm cloud workspace. The conversation continues there.");
    console.log(`Cloud thread: ${result.threadLink}`);
    if (result.appLink) console.log(`Open in a T3 Code app (one-time link): ${result.appLink}`);
    console.log(`Workspace: ${result.workspaceId}`);
    for (const warning of result.warnings) console.log(chalk.yellow(`Warning: ${warning}`));
    console.log(chalk.dim("Bring it back later with: gitterm t3 return"));
  } catch (err) {
    reporter.stop();
    handleError(err, args.json);
  }
}

function pickRecord(records: MoveRecord[], workspaceId?: string): MoveRecord {
  const open = records.filter((record) => !record.returnedAt);
  const match = workspaceId
    ? open.find((record) => record.workspaceId === workspaceId)
    : (open.find((record) => record.localThreadId === process.env.T3CODE_THREAD_ID) ??
      (open.length === 1 ? open[0] : undefined));
  if (match) return match;
  if (!open.length) throw new Error("No thread from this machine is in the cloud.");
  throw new Error(
    `Several threads are in the cloud; name one: ${open.map((record) => record.workspaceId).join(", ")}`,
  );
}

export async function runT3Return(
  args: JsonArgs & {
    workspaceId?: string;
    force: boolean;
    end: "pause" | "delete" | "keep";
    message?: string;
    detached?: boolean;
  },
) {
  const reporter = progressReporter(args.json || args.detached);
  try {
    const record = pickRecord(await loadRecords(), args.workspaceId);
    const local = localMachine();

    // Run from the thread it returns to, it waits for the thread's reply to end: the thread's
    // session can only be replaced while nothing writes to it.
    if (!args.detached && record.localThreadId === process.env.T3CODE_THREAD_ID) {
      const dir = path.join(process.env.HOME || homedir(), ".config", "gitterm");
      mkdirSync(dir, { recursive: true });
      const log = path.join(dir, `t3-return-${record.workspaceId}.log`);
      const out = openSync(log, "a");
      const child = spawn(
        process.execPath,
        [
          process.argv[1]!,
          "t3",
          "return",
          record.workspaceId,
          "--detached",
          "--end",
          args.end,
          ...(args.force ? ["--force"] : []),
          ...(args.message ? ["--message", args.message] : []),
        ],
        { detached: true, stdio: ["ignore", out, out] },
      );
      child.unref();
      reporter.stop();
      const result = { scheduled: true, workspaceId: record.workspaceId, log };
      if (args.json) return printJson(result);
      success(
        "The cloud thread comes back once this reply ends; this thread then wakes up with a summary.",
      );
      console.log(chalk.dim(`Log: ${log}`));
      return;
    }

    if (args.detached) {
      for (let waited = 0; ; waited += 2) {
        const status = await local.t3<{ busy: boolean }>("status", {
          threadId: record.localThreadId,
        });
        if (!status.busy) break;
        if (waited > 30 * 60) throw new Error("The thread was still working after 30 minutes.");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    const result = await returnFromCloud(
      { cloud: gittermCloud(createGittermClient()), local, progress: reporter.progress },
      record,
      { force: args.force, end: args.end, message: args.message },
    ).catch(async (error: unknown) => {
      if (args.detached)
        await local
          .t3("send", {
            threadId: record.localThreadId,
            message: `[GitTerm] Bringing this thread back from the cloud failed: ${error instanceof Error ? error.message : String(error)}\nNothing here changed; the cloud workspace ${record.workspaceId} is as it was. Tell the user, then wait.`,
          })
          .catch(() => {});
      throw error;
    });
    reporter.stop();
    if (args.json) return printJson(result);
    success("Back from the cloud: the checkout and conversation are here again.");
    console.log(`Thread: ${result.threadLink}`);
  } catch (err) {
    reporter.stop();
    handleError(err, args.json);
  }
}

export async function runT3Create(
  args: JsonArgs & {
    repo?: string;
    ref?: string;
    access: string;
    provider?: string;
    connection?: string[];
  },
) {
  const reporter = progressReporter(args.json);
  try {
    let repo = args.repo;
    let name = "T3 Code environment";
    if (!repo) {
      const root = await checkoutRoot(process.cwd()).catch(() => undefined);
      repo = root ? await repositoryUrl(root) : undefined;
      if (root) name = `${path.basename(root)} (T3 Code)`;
    }
    const result = await createEnvironment(
      {
        cloud: gittermCloud(createGittermClient(), {
          provider: args.provider,
          connections: args.connection,
        }),
        progress: reporter.progress,
      },
      { name, repo, branch: args.ref, access: args.access },
    );
    reporter.stop();
    if (args.json) return printJson(result);
    success(`Linked a cloud workspace to your T3 Code${repo ? ` with ${repo}` : ""}.`);
    console.log(`environmentId: ${result.environmentId}`);
    console.log(`projectId:     ${result.projectId}`);
    console.log(`workspaceId:   ${result.workspaceId}`);
    console.log(chalk.dim(`Delete it when done: gitterm t3 delete ${result.workspaceId}`));
  } catch (err) {
    reporter.stop();
    handleError(err, args.json);
  }
}

export async function runT3Delete(args: JsonArgs & { workspaceId: string; pause?: boolean }) {
  try {
    const client = createGittermClient();
    const url = await client.workspaces.getRuntimeAccess(args.workspaceId).then(
      (runtime) => runtime.url,
      () => null,
    );
    await endEnvironment(
      gittermCloud(client),
      args.workspaceId,
      url,
      args.pause ? "pause" : "delete",
    );
    if (args.json)
      return printJson({ workspaceId: args.workspaceId, ended: args.pause ? "paused" : "deleted" });
    success(args.pause ? "Paused the workspace." : "Unlinked and deleted the workspace.");
  } catch (err) {
    handleError(err, args.json);
  }
}

export async function runT3List(args: JsonArgs) {
  try {
    const records = (await loadRecords()).filter((record) => !record.returnedAt);
    if (args.json) return printJson(records);
    if (!records.length) return console.log("No threads from this machine are in the cloud.");
    for (const record of records)
      console.log(
        `${record.workspaceId}  ${record.localThreadId} → ${record.cloudThreadId}  (moved ${record.movedAt})`,
      );
  } catch (err) {
    handleError(err, args.json);
  }
}
