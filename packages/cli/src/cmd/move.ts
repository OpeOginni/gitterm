import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createGittermClient } from "@gitterm/sdk";
import chalk from "chalk";
import { checkoutRoot, repositoryUrl } from "@gitterm/move/checkout/snapshot";
import { AGENTS, agentByKey, currentSession } from "@gitterm/move/agents/index";
import { pairEnvironment, unpairEnvironment } from "@gitterm/move/agents/t3";
import { moveToCloud, returnFromCloud } from "@gitterm/move/flows";
import { gittermCloud } from "@gitterm/move/gitterm";
import { localMachine } from "@gitterm/move/machine";
import { loadRecords, type MoveRecord } from "@gitterm/move/records";
import { installSkill } from "../move/skill.js";
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

export async function runSetup(args: JsonArgs) {
  try {
    const local = localMachine();
    const changes: string[] = [];
    for (const agent of AGENTS)
      if (agent.setup) changes.push(...(await agent.setup(local).catch(() => [])));
    const skills = await installSkill();
    let signedIn: string | null = null;
    try {
      signedIn = (await createGittermClient().auth.status()).email;
    } catch {
      /* Reported below. */
    }
    if (args.json) return printJson({ changes, skills, signedIn });
    for (const change of changes) success(change);
    success(`Installed the gitterm-cloud skill: ${skills.join(", ")}`);
    if (signedIn) success(`Signed in to GitTerm as ${signedIn}.`);
    else console.log(chalk.yellow("Not signed in to GitTerm: run `gitterm login`."));
    console.log("\nAsk your agent to move its session to the cloud (the gitterm-cloud skill).");
  } catch (err) {
    handleError(err, args.json);
  }
}

/** The session to move: the one this process runs in, or the one named. */
function sessionToMove(args: { agent?: string; session?: string }) {
  const current = currentSession();
  if (args.session) {
    const agent = agentByKey(args.agent ?? current?.agent.key ?? "");
    return { agent, ref: args.session, fromSession: current?.ref === args.session };
  }
  if (!current)
    throw new Error(
      "Run this from a supported agent's session, or pass --agent and --session. Supported: " +
        AGENTS.map((agent) => agent.key).join(", "),
    );
  return { ...current, fromSession: true };
}

export async function runMove(
  args: JsonArgs & {
    message?: string;
    agent?: string;
    session?: string;
    changes: boolean;
    provider?: string;
    connection?: string[];
  },
) {
  const reporter = progressReporter(args.json);
  try {
    const { agent, ref, fromSession } = sessionToMove(args);
    const result = await moveToCloud(
      {
        cloud: gittermCloud(createGittermClient(), {
          provider: args.provider,
          connections: args.connection,
        }),
        local: localMachine(),
        agent,
        progress: reporter.progress,
      },
      { ref, message: args.message, changes: args.changes, fromSession },
    );
    reporter.stop();
    if (args.json) return printJson(result);
    success("Moved to a GitTerm cloud workspace. The conversation continues there.");
    for (const [label, link] of Object.entries(result.links)) console.log(`${label}: ${link}`);
    console.log(`Workspace: ${result.workspaceId}`);
    for (const warning of result.warnings) console.log(chalk.yellow(`Warning: ${warning}`));
    console.log(chalk.dim("Bring it back later with: gitterm return"));
  } catch (err) {
    reporter.stop();
    handleError(err, args.json);
  }
}

function pickRecord(
  records: MoveRecord[],
  pick: { workspaceId?: string; session?: string },
): MoveRecord {
  const open = records.filter((record) => !record.returnedAt);
  const session = pick.session ?? currentSession()?.ref;
  const match = pick.workspaceId
    ? open.find((record) => record.workspaceId === pick.workspaceId)
    : (open.find((record) => session && record.localRef === session) ??
      (!pick.session && open.length === 1 ? open[0] : undefined));
  if (match) return match;
  if (!open.length) throw new Error("No session from this machine is in the cloud.");
  throw new Error(
    `Several sessions are in the cloud; name one: ${open.map((record) => record.workspaceId).join(", ")}`,
  );
}

export async function runReturn(
  args: JsonArgs & {
    workspaceId?: string;
    session?: string;
    force: boolean;
    end: "pause" | "delete" | "keep";
    message?: string;
    detached?: boolean;
  },
) {
  const reporter = progressReporter(args.json || args.detached);
  try {
    const record = pickRecord(await loadRecords(), args);
    const agent = agentByKey(record.agent);
    const local = localMachine();
    const inside = record.localRef === currentSession()?.ref;
    if (inside && agent.insideReturn) throw new Error(agent.insideReturn);

    // Run from the session it returns to, it waits for the session's reply to end: a session
    // can only be replaced while nothing writes to it.
    if (!args.detached && inside) {
      const dir = path.join(process.env.HOME || homedir(), ".config", "gitterm");
      mkdirSync(dir, { recursive: true });
      const log = path.join(dir, `return-${record.workspaceId}.log`);
      const out = openSync(log, "a");
      const child = spawn(
        process.execPath,
        [
          process.argv[1]!,
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
        "The cloud session comes back once this reply ends; this session then wakes up with a summary.",
      );
      console.log(chalk.dim(`Log: ${log}`));
      return;
    }

    if (args.detached) {
      for (let waited = 0; ; waited += 2) {
        const status = await agent.session(local).status({ ref: record.localRef });
        if (!status.busy) break;
        if (waited > 30 * 60) throw new Error("The session was still working after 30 minutes.");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    const result = await returnFromCloud(
      { cloud: gittermCloud(createGittermClient()), local, agent, progress: reporter.progress },
      record,
      { force: args.force, end: args.end, message: args.message },
    ).catch(async (error: unknown) => {
      if (args.detached)
        await agent
          .session(local)
          .notify({
            ref: record.localRef,
            where: "local",
            message: `[GitTerm] Bringing this session back from the cloud failed: ${error instanceof Error ? error.message : String(error)}\nNothing here changed; the cloud workspace ${record.workspaceId} is as it was. Tell the user, then wait.`,
          })
          .catch(() => {});
      throw error;
    });
    reporter.stop();
    if (args.json) return printJson(result);
    success("Back from the cloud: the checkout and conversation are here again.");
    if (result.link) console.log(`Session: ${result.link}`);
  } catch (err) {
    reporter.stop();
    handleError(err, args.json);
  }
}

export async function runMoves(args: JsonArgs) {
  try {
    const records = (await loadRecords()).filter((record) => !record.returnedAt);
    if (args.json) return printJson(records);
    if (!records.length) return console.log("No sessions from this machine are in the cloud.");
    for (const record of records)
      console.log(
        `${record.workspaceId}  ${record.agent} ${record.localRef} → ${record.cloudRef}  (moved ${record.movedAt})`,
      );
  } catch (err) {
    handleError(err, args.json);
  }
}

/** A T3 Code workspace linked to this machine's T3 Code, for `delegate_task`. */
export async function runT3Link(
  args: JsonArgs & {
    repo?: string;
    ref?: string;
    access: string;
    provider?: string;
    connection?: string[];
  },
) {
  const reporter = progressReporter(args.json);
  const client = createGittermClient();
  const cloud = gittermCloud(client, { provider: args.provider, connections: args.connection });
  let workspaceId: string | undefined;
  try {
    let repo = args.repo;
    let name = "T3 Code environment";
    if (!repo) {
      const root = await checkoutRoot(process.cwd()).catch(() => undefined);
      repo = root ? await repositoryUrl(root) : undefined;
      if (root) name = `${path.basename(root)} (T3 Code)`;
    }
    reporter.progress("Creating the cloud workspace");
    workspaceId = await cloud.create({
      agent: "t3code",
      name,
      repo,
      branch: args.ref,
      metadata: { "t3.environment": "linked" },
      idempotencyKey: `t3-environment:${crypto.randomUUID()}`,
    });
    reporter.progress("Waiting for the workspace to start");
    const { url, directory } = await cloud.ready(workspaceId);
    reporter.progress("Linking it to your T3 Code");
    const linked = await pairEnvironment(cloud.machine(workspaceId), {
      url,
      cwd: directory,
      access: args.access,
    });
    reporter.stop();
    const result = { workspaceId, ...linked, url };
    if (args.json) return printJson(result);
    success(`Linked a cloud workspace to your T3 Code${repo ? ` with ${repo}` : ""}.`);
    console.log(`environmentId: ${result.environmentId}`);
    console.log(`projectId:     ${result.projectId}`);
    console.log(`workspaceId:   ${result.workspaceId}`);
    console.log(chalk.dim(`Delete it when done: gitterm t3 unlink ${result.workspaceId}`));
  } catch (err) {
    reporter.stop();
    if (workspaceId) await cloud.end(workspaceId, "delete").catch(() => {});
    handleError(err, args.json);
  }
}

export async function runT3Unlink(args: JsonArgs & { workspaceId: string; pause?: boolean }) {
  try {
    const client = createGittermClient();
    const url = await client.workspaces.getRuntimeAccess(args.workspaceId).then(
      (runtime) => runtime.url,
      () => null,
    );
    if (url && !args.pause) await unpairEnvironment(url);
    await gittermCloud(client).end(args.workspaceId, args.pause ? "pause" : "delete");
    if (args.json)
      return printJson({ workspaceId: args.workspaceId, ended: args.pause ? "paused" : "deleted" });
    success(args.pause ? "Paused the workspace." : "Unlinked and deleted the workspace.");
  } catch (err) {
    handleError(err, args.json);
  }
}
