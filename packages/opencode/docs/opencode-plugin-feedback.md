# Building GitTerm on the OpenCode plugin system

Notes for the OpenCode team from GitTerm, November 2026, written against OpenCode 2.4.1. Source
links point at the [`v2.4.1` tag](https://github.com/anomalyco/opencode/tree/v2.4.1).

`@gitterm/opencode` does two things:

- **Sandbox tools.** The agent runs builds, tests and previews in a remote sandbox while the
  conversation and files stay on the user's machine.
- **`/cloud`.** It moves a live session to a cloud workspace and back: the conversation, the Git
  checkout with uncommitted changes, and an agent that is mid-answer.

The move logic is shared with the `gitterm` CLI and our Pi extension, so the plugin is mostly
UI. The CLI can also move an OpenCode session from outside OpenCode, through the server's HTTP
API, and both read the same move records.

Most of what we hit falls into a few groups:

- A server plugin can't reach the server's own API, so it has to log in to it like an outside client (4.1).
- Nothing says when a session's background work is really finished, and nothing keeps a session still (3.5, 3.6, 4.2, 4.3, 4.4).
- Replacing a session's contents takes five calls and a backup copy (4.6).
- A plugin can't tell the agent something at a point in the conversation without it reading as the user (4.7).
- OpenCode's experimental machines could replace most of our sandbox tools, if a sandbox can join as one (4.9).

Fixing those would help any plugin that runs long work or changes the agent's surroundings. The
architecture and handoff flow are in [`internals.md`](./internals.md).

---

## 1. What we built

```
 Your machine                          GitTerm API            Cloud workspace
 ┌──────────────────────────┐         ┌────────────┐         ┌────────────────────────┐
 │ Terminal  (tui plugin)   │         │ create     │         │ OpenCode server        │
 │   ▲ plugin RPC           │         │ wake       │         │ (stock, no plugin)     │
 │ OpenCode server          │────────▶│ delete     │────────▶│ restored Git checkout  │
 │   (server plugin)        │         └────────────┘         │ same session ID        │
 │ gitterm CLI (same flows) │                                │                        │
 │ Git checkout             │════════════════════════════════▶                        │
 └──────────────────────────┘     HTTP: file.write, shell,    └────────────────────────┘
                                  session.import, prompt
```

`/cloud [message]`:

1. Signs in to GitTerm with a device code if needed, shown in a form.
2. If the session is already in a workspace, whether `/cloud` or the CLI moved it, reconnects to that one instead of creating a second.
3. Asks whether to bring uncommitted changes, only if there are any.
4. If the agent is running, interrupts it and every subagent until they stay stopped.
5. Packs the checkout and exports the session.
6. Creates a workspace, uploads the snapshot with `file.write` and restores it with `shell.create`.
7. Imports the session under the same ID and adds an instruction entry saying it changed machines.
8. Restarts the agent with `prompt` (your message) or `synthetic({ resume: true })`.

`/cloud-return` does the reverse:

1. Checks the cloud agent is at rest and copies the cloud's conversation and checkout.
2. Applies the checkout locally, asking first if local work changed.
3. Replaces the local conversation with the cloud's (4.6).
4. Reads the cloud session again. Only if it did not change does it delete, snapshot or pause the workspace (4.4).

## 2. The plugin APIs we use

| API                                               | What we use it for                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `Plugin.define` + `options`                       | Server and terminal halves from one package                              |
| `ctx.rpc.register` / `context.client.rpc`         | Progress events from server to terminal, and cancel from terminal back   |
| `ctx.command.transform`                           | `/cloud` and `/cloud-return`                                             |
| `ctx.tool.transform` with `namespace`             | The sandbox tools, grouped, with the main ones pinned in code mode       |
| `ctx.permission.assert`                           | Asking before a sandbox gets local files, secrets or a public preview    |
| `ctx.session.hook("prompt")`                      | Asks before a local message forks a conversation that lives in the cloud |
| `ctx.session.hook("fork")`                        | Strips our cloud marker from forks                                       |
| `ctx.session.synthetic`                           | Telling the agent a background sandbox job finished                      |
| `session.instructions.entry.put`                  | "You moved machines", which survives compaction                          |
| `session.synthetic({ resume })`                   | Restarting a stopped agent with a note                                   |
| `session.export` / `import` / `fork`              | Moving the conversation, keeping the ID, with a fork as the backup       |
| `form.create`, including `external` fields        | Questions, sign-in and the pairing link                                  |
| `OPENCODE_SESSION_ID` in shell commands           | The CLI, run by the agent, knows which session it belongs to             |
| TUI `ui.slot`, `ui.dialog`, `ui.toast`, `data.on` | Sidebar status, progress dialog, sign-in and QR dialogs, notifications   |

What worked well and should stay:

- **Plugin RPC.** Typed calls plus custom events between the two halves. Our first version passed progress and cancel through session metadata, where writes raced and an import wiped them. RPC removed all of that.
- **Commands run while the agent is busy.** That is what makes a mid-answer move possible.
- **Instruction entries** for facts about the session's environment, and the `<env>` block updating itself after a move.
- **Same-ID import.** A moved session looks like the same session everywhere.
- **Native forms and permission prompts.** We didn't build our own question UI, and our tools get OpenCode's "Always" for free.
- **Tool namespaces.** Pinning a few tools and listing the rest keeps code mode's tool list short.
- **Driving a server through `file` and `shell` alone.** We reach the cloud workspace only through its OpenCode server, so moving works on sandbox providers that have no command API of their own.
- **Per-project plugin options.** A project's `opencode.json` entry replaces the global entry's options there, and `"-gitterm"` turns the plugin off for that project.

## 3. Bugs

### 3.1 `command.updated` from a plugin never reaches the terminal

`ctx.command.reload()` publishes `Command.Event.Updated` with `{}` ([command.ts:70](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/command.ts#L70)). The bus only adds a location when a `Location.Service` is in context ([bus.ts:512-517](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/bus.ts#L512-L517)), and plugin code runs without one ([plugin.ts:83-87](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/plugin.ts#L83-L87)). The terminal drops events with no location ([data.ts:1460](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/client/src/solid/data.ts#L1460)). So a command a plugin adds at runtime is invisible until restart.

- Workaround: our terminal plugin listens for `command.updated` and calls `location.command.invalidate()` and `sync()` itself.
- We have since stopped adding `/cloud-return` at runtime. The CLI can move a session without the plugin knowing, so the command is always there and says so when the session isn't in the cloud (see 4.8, commands per project).
- Likely the same, untested: `skill.updated` from [skill.ts:159](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/skill.ts#L159).

### 3.2 The terminal leaves a session that is deleted and imported again

Deleting the open session drops its tab and sends the terminal home ([app.tsx:1408-1418](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/tui/src/app.tsx#L1408-L1418)). When the same ID is imported again, `session.created` treats it as a new, empty session and marks its messages as loaded without fetching them ([data.ts:852-863](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/client/src/solid/data.ts#L852-L863)). The terminal then shows an empty conversation, even though the server returns every message.

- Workaround: we poll `ui.router.current()` every 500 ms to know which session is open, and on `session.created` for that ID we invalidate, sync and navigate back.
- There is no route-change event ([tui/context.ts:501-505](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/plugin/src/tui/context.ts#L501-L505)). `current()` may be a Solid store that a `createEffect` could watch, but that isn't documented.
- Still open: if the delete and the import land in the same instant, the tab isn't added back.

  4.6 would remove the need for all of this.

### 3.3 A prompt hook that throws gives an empty 500

When `session.hook("prompt")` throws, the throw becomes a defect ([adapter.ts:675](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/plugin/src/promise/adapter.ts#L675)). The prompt handler returns an empty 500 ([handlers/session.ts:290-315](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/server/src/handlers/session.ts#L290-L315)) and the typed message disappears. We show a form before throwing so the user knows why. A typed rejection with a message the terminal shows would be better.

### 3.4 Form rendering

- A field with no title shows its raw key ([form.ts:16](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/tui/src/util/form.ts#L16)).
- A field's description replaces its title ([form.tsx:885](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/tui/src/routes/session/form.tsx#L885)). With one field there are no tabs, so the question has to go in the form title.
- An `external` field always shows "Open or copy the URL, complete the external action, then confirm" ([form.tsx:875-876](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/tui/src/routes/session/form.tsx#L875-L876)), and only `true` is a valid answer ([form.tsx:128](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/tui/src/routes/session/form.tsx#L128)). For sign-in we needed a code, a QR code and "close to cancel", so our terminal plugin watches `form.created` for our own field key, draws its own dialog on top, and calls `form.cancel` when it closes. A way for a terminal plugin to render a field, or a description that replaces the default line, would remove that.

### 3.5 Background work finishes in a moment where nothing looks busy

When a subagent finishes, its report goes into the parent's inbox ([subagent-completion.ts:75](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/session/subagent-completion.ts#L75)), then the job is completed ([subagent-completion.ts:85](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/session/subagent-completion.ts#L85)), then the parent wakes ([subagent-report.ts:128](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/session/execution/subagent-report.ts#L128)). In between there is no running job, the parent isn't active, and a report is waiting. A client asking "is this session done?" then gets the wrong answer. Waking the parent before completing the job would close the gap.

### 3.6 Jobs stay `running` forever after a crash on plain `opencode serve`

After a `kill -9` and restart, `experimental.job.list` still showed a subagent job and a shell
job as `running` 50 s later. The subagent never resumed and the shell no longer existed. Under
`serve --service` the same subagent resumed and finished. Only the service passes the lifecycle
that installs the restart sweep ([server-process.ts:152-153](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/cli/src/server-process.ts#L152-L153), [process.ts:126-129](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/server/src/process.ts#L126-L129)).

Any client that waits on jobs hangs, `opencode run` included. Running the restart sweep on plain
`serve`, or settling job rows the new process doesn't own, would fix it. `server.info` is also
identical in both modes, so a client can't tell whether a restart will be recovered.

### 3.7 A config change can unload a plugin in the middle of a command

A config change reloads every plugin from the first changed entry onward ([plugin.ts:122-140](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/plugin.ts#L122-L140)). We hit this for real: `/cloud-return` stashes local changes. If the project's `opencode.json` was uncommitted and lists our plugin, the stash changes our entry, and OpenCode unloads the plugin halfway through the return.

Delaying the reload until running commands finish, or letting a plugin say it is busy, would fix it.

## 4. Improvements that would help every plugin

Ordered by how much code they would have saved us.

### 4.1 Give server plugins the same reach as an HTTP client

- The plugin `session` domain is a `Pick` of the HTTP API with no `export`, `import`, `fork`, `active`, `inbox`, `form` or `job` ([promise/session.ts:225-245](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/plugin/src/promise/session.ts#L225-L245)). The plugin context has no client ([promise/plugin.ts:27-61](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/plugin/src/promise/plugin.ts#L27-L61)), and `ctx.rpc` only reaches methods plugins register, not the server's own API.
- So our server plugin builds a second, authenticated client to its own server, through `Service.discover()` or a `localServerUrl` option.
- Under `opencode --standalone` the server is on a random port ([standalone.ts:20](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/cli/src/services/standalone.ts#L20)) and removes `OPENCODE_SERVER_PASSWORD` from its environment ([server-process.ts:89](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/cli/src/server-process.ts#L89)). There `/cloud` can't work at all, and we tell users to run `opencode serve` themselves.

Proposal: `ctx.client`, an `OpenCodeClient` already bound to the host server and the plugin's
location, like the terminal plugin's `context.client`. Or widen the `Pick`. Either way a plugin
never needs credentials for the server it runs in. This would help any plugin that does backups,
sync, sharing or migration.

### 4.2 One "is this session really idle?" answer

To decide whether a session is busy, we combine `session.active`, `experimental.job.list({ descendants: true })` and `session.inbox.list`, then sort inbox items by `payload.metadata.source`, because a `resume: false` note looks the same as a subagent report that will wake the parent.

OpenCode already computes this as `SessionBackground.outstanding`, but only plugins see it, inside the `experimental.idle` hook ([llm.ts:182-185](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/session/runner/llm.ts#L182-L185)). The experimental `session.wait` endpoint ([groups/session.ts:462](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/protocol/src/groups/session.ts#L462)) waits for the agent loop only, not jobs or the inbox.

Proposal:

- Expose the outstanding list over HTTP, for example `GET /session/:id/status` returning `{ active, jobs, waking }`, or make `session.wait` cover jobs and the inbox.
- Add a `resume` flag to each inbox item.
- Fix the order in 3.5.

Every SDK user or bot that waits for a run needs this. Our CLI, our plugin, our Slack and Discord bots and `opencode run` each rebuild it, with different edge cases.

### 4.3 Stop a session and everything under it

`session.interrupt` stops the parent only ([execution.ts:30-35](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/session/execution.ts#L30-L35)). Each stopped subagent then reports back, which wakes the parent again. Our `stopSession` loops: interrupt the parent and every child session, then wait for three quiet checks 200 ms apart, with a 15 s deadline.

`experimental.job.cancel` ([groups/job.ts:45-56](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/protocol/src/groups/job.ts#L45-L56)) doesn't help here. We tried it on 2.4.1 with a parent at rest and its subagent still working: cancelling the subagent's job sent the parent a `<background-result kind="subagent" state="cancelled">` report and woke it, the same as interrupting the child session. So we kept our loop.

Proposal: `session.interrupt({ sessionID, subagents: true })` that stops descendants and holds back their cancellation reports.

### 4.4 Keep a session still

To bring a session back, we copy the cloud conversation, replace the
local one with it, then delete the cloud workspace. In between, the cloud session can take
another turn: a queued message, a subagent report, someone typing in the browser. Deleting the
workspace then loses that turn.

OpenCode has no way to stop a session from taking new input. For our Pi integration we stop the
agent process itself. For OpenCode, we check whether the cloud session changed just before
deleting, and keep the workspace with a warning if it did. That makes the window small, but it
is still there.

The check uses the experimental session log ([groups/session.ts:659](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/protocol/src/groups/session.ts#L659)). Read with `after` past the end and no `follow`, it returns only `log.synced` with the session's current sequence number. We read it before exporting the cloud session and again before deleting. On 2.4.1, a queued prompt, a synthetic note and a metadata update each raise it, while reading or viewing the session doesn't. Before, we exported the whole conversation again and compared, which was slower and missed a message queued in the inbox, since an export leaves those out. Nothing documents the sequence as a session's revision, though, and reading it means opening an event stream.

Proposal, either or both:

- `session.hold({ sessionID })` and `release`: while held, prompts are refused and nothing wakes the session. Queued items stay queued.
- The log's sequence number on `session.get`, documented as the session's revision, so a client can tell whether a session changed with one plain request.

Any tool that copies, archives or hands off a session needs this, not only ours.

### 4.5 Waiting instead of polling

| What           | We do today                                     | Would rather                                               |
| -------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| A form answer  | `form.get` every 400 ms                         | `form.wait({ formID })`                                    |
| A shell        | `shell.get` every 200 ms                        | `shell.wait({ id })` returning the exit code               |
| Model catalog  | `model.list` until it stops growing, up to 15 s | a "catalog ready" flag in `server.info`                    |
| Terminal route | `router.current()` every 500 ms                 | `router.onChange`, or document that `current()` is a store |

`form.replied`, `form.cancelled` and `shell.exited` events exist, but the shell runs on a remote
server, and waiting on an event means subscribing first and handling a missed one. A wait call is
simpler for every HTTP client. `server.info` has no readiness field.

### 4.6 Replace a session's contents in place

`import` over an existing ID fails with "Session already exists" ([transfer.ts:76](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/session/transfer.ts#L76)), and message IDs are unique across the server ([sql.ts:89](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/session/sql.ts#L89)). So to bring a conversation back we delete the session and import it again. That causes 3.2, and a crash or a failed import between the two steps loses the session. What we do now:

1. Export the local session and fork it as a backup. A session with no messages can't be forked ([session.ts:363](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/session.ts#L363)), so that case is skipped.
2. Remove the session and import the new conversation under its ID.
3. Export it again and check every message arrived.
4. If anything failed, remove what was imported, import the original again and check that too.
5. Remove the fork only once one of the two checks passed. Otherwise the error names the fork, so the user can find their conversation.

Proposal: `session.import({ ..., replace: true })` as one transaction, with one `session.updated`
event so clients just refresh.

### 4.7 Let plugins tell the agent something at a point in the conversation

Instruction entries give the agent standing facts. What a plugin can't control is when the agent learns them.

- On a session the model has already seen, a changed entry becomes a stored `system` message at that point, sent as `<system-update>` ([shared.ts:228](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/ai/src/protocols/shared.ts#L228)). That is right. On a session with no instruction history on this server, such as one just imported, it only goes into the system prompt, with no place in the conversation (the `initial` case in [instruction-state.ts:44-58](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/session/instruction-state.ts#L44-L58)).
- A plugin can't add a `system` message itself. `session.synthetic` reaches the model as a `user` message ([to-llm-message.ts:274-275](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/session/runner/to-llm-message.ts#L274-L275)), so unwrapped it reads as if the user typed it.

What it cost us: after a session came back from the cloud, the agent was asked which machine it
was on. It ran `hostname`, saw the Mac, and called its earlier correct answer ("a Linux cloud
workspace") a mistake. The fact was in its system prompt, but nothing said when it changed. We
now also send a synthetic note wrapped in `<session-moved source="gitterm">` saying it is not from
the user, copying how OpenCode wraps subagent reports. Our sandbox job notices do the same with
`<sandbox-job>`. Every plugin has to invent its own wrapper.

Any plugin that changes the agent's surroundings mid-session needs this: a worktree or branch
switch, a new secret, a deploy or CI result, a sandbox starting or stopping.

Proposal, any one of:

- `entry.put({ ..., announce: true })`, which always records a `<system-update>` at this point.
- `session.synthetic({ ..., role: "system" })`, or a `session.notice()` sent as `<system-update>`.
- Treat the first entry put after `session.import` as an update, not the baseline.

Each of these adds a message at the end of the conversation, the way OpenCode's own updates
already work. None changes earlier messages or the system prompt, so the prompt cache stays
valid. OpenCode keeps the system prompt fixed on purpose
([instruction-state.ts:142-144](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/session/instruction-state.ts#L142-L144)).

### 4.8 Smaller ones

- **Forks copy all metadata** ([projector.ts:177](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/session/projector.ts#L177)) and instruction entries ([session.ts:368-369](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/session.ts#L368-L369)). The `fork` hook lets us strip our marker. Worth a line in the hook's docs, or a way to mark metadata keys as not forked.
- **Export leaves out instruction entries** ([transfer.ts:61-66](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/session/transfer.ts#L61-L66)). Right for us, but not documented.
- **Client errors carry `_tag`, not the HTTP status**, for declared errors. A `status` field would help generic handling.
- **Plugins can't register a job kind.** OpenCode's own long work (shells, subagents, Code Mode, video) shows in the job list and can be cancelled, but a plugin's long work, like our sandbox jobs, can't show in the job list or survive a reload. We keep our own records and restart our watches on load.
- **Commands are per project.** `/cloud-return` shows in every session of the checkout ([command.ts:13-17](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/plugin/src/promise/command.ts#L13-L17)), and only makes sense in one. An optional `when(sessionID)` would fix it.
- **RPC before plugins load.** A call that arrives before a project's plugins load fails with `rpc.unavailable` ([rpc.ts:110](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/rpc.ts#L110)) instead of waiting. Worth a note in the RPC docs that callers should retry.
- **Running a script without Node.** We run our restore script locally with `BUN_BE_BUN=1 <opencode binary> -e`. It relies on OpenCode staying a Bun executable. A supported `opencode run-script` would be safer.

### 4.9 Machines, and sandboxes as machines

The experimental `machines` flag ([flag.ts:20](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/schema/src/config/flag.ts#L20)) lets the agent's own tools act on another machine: a path such as `gpu:/work/train.py` for read, write and edit, and the machine as the shell's workdir ([instructions.ts:12](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/machine/instructions.ts#L12)). That is most of what our sandbox tools do, through tools the model already knows.

On `dev`, the server can also attach to a worker over any byte stream, "such as `ssh host opencode-worker stdio` or container `exec`" ([worker-client.ts:218-221](https://github.com/anomalyco/opencode/blob/7b8a065e29ad493ff5125356c1136b472b482805/packages/core/src/machine/worker-client.ts#L218-L221)). Sandbox providers give us exactly that: an exec stream, but usually no way in from the outside.

We'd like GitTerm sandboxes to show up as machines, with our tools kept only for what machines don't cover (previews, snapshots, background jobs that wake the session). Questions:

- Will `opencode-worker` ship as a binary we can install in a sandbox image, and is the stdio frame format meant to stay stable?
- Can a plugin add a machine that it connects itself, for example `ctx.machine.attach(name, stdio)`? `machine.add` today makes a join string for a worker that dials in.
- Will the flag be on in releases?

## 5. On our side

- Move records live in `~/.config/gitterm/moves/`, outside OpenCode, so the CLI and the plugin see the same moves. We dropped `ctx.storage` for that reason, not because of a problem with it.
- Our progress, sign-in and status UI is a terminal plugin. In OpenCode Desktop and the web app, users get the forms but no progress dialog or cloud status. A GUI plugin (`@opencode/plugin/gui`) would cover that; we haven't built one yet.
- An uncommitted project `opencode.json` that points at a local plugin path gets copied to the cloud, where it logs a harmless "failed to load plugin".

## 6. How we tested

- Two real `opencode serve` processes with separate `HOME` and `XDG_*` directories, one acting as the cloud and reached only through its HTTP API.
- A fake OpenAI-compatible model that streams slowly, so we can stop an agent mid-answer.
- A fake GitTerm API, including device sign-in.
- A fake OpenCode client for the failure paths of 4.6: an import that throws, or that comes back with a message missing.
- The real terminal UI, driven through a pseudo-terminal and read from the screen.

Happy to turn any of section 3 or 4 into issues or PRs.
