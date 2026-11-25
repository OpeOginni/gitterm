# Building `/cloud` on the OpenCode plugin system

Notes for the OpenCode team from GitTerm, November 2026, written against OpenCode 2.3.0. Source
links point at the [`v2.3.0` tag](https://github.com/anomalyco/opencode/tree/v2.3.0). We checked
`dev` as of Nov 14 and none of these were fixed there yet.

`@gitterm/opencode-cloud` moves a live OpenCode session to a cloud machine and back. It moves the
conversation, the Git checkout with uncommitted changes, and an agent that is mid-answer. It is
one server plugin and one terminal plugin on the user's machine, and they talk over plugin RPC.
The cloud side is a stock OpenCode server driven over HTTP.

Most of what we hit falls into a few groups:

- A server plugin can't reach the server's own API, so it has to log in to it like an outside client (4.1).
- Nothing says when a session's background work is really finished (3.5, 3.6, 4.2, 4.3).
- A plugin can't tell the agent something at a point in the conversation without it reading as the user (4.6).

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
 │ Git checkout             │════════════════════════════════▶                        │
 └──────────────────────────┘     HTTP: file.write, shell,    └────────────────────────┘
                                  session.import, prompt
```

`/cloud [message]`:

1. Signs in to GitTerm with a device code if needed, shown in a form.
2. Asks whether to bring uncommitted changes, only if there are any.
3. If the agent is running, interrupts it and every subagent until they stay stopped.
4. Packs the checkout and exports the session.
5. Creates a workspace, uploads the snapshot with `file.write` and restores it with `shell.create`.
6. Imports the session under the same ID and adds an instruction entry saying it changed machines.
7. Restarts the agent with `prompt` (your message) or `synthetic({ resume: true })`.

`/cloud-return` does the reverse: it checks the cloud agent is at rest, applies what the cloud
changed, replaces the local conversation with the cloud's (delete, then import under the same ID)
and deletes, snapshots or pauses the workspace.

## 2. The plugin APIs we use

| API                                               | What we use it for                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `Plugin.define` + `options`                       | Server and terminal halves from one package                              |
| `ctx.rpc.register` / `context.client.rpc`         | Progress events from server to terminal, and cancel from terminal back   |
| `ctx.command.transform` / `reload`                | `/cloud` always, `/cloud-return` only while a session is in the cloud    |
| `ctx.session.hook("prompt")`                      | Asks before a local message forks a conversation that lives in the cloud |
| `ctx.session.hook("fork")`                        | Strips our cloud marker from forks                                       |
| `session.instructions.entry.put`                  | "You moved machines", which survives compaction                          |
| `session.synthetic({ resume })`                   | Restarting a stopped agent with a note                                   |
| `session.export` / `import`                       | Moving the conversation, keeping the ID                                  |
| `form.create`, including `external` fields        | Questions, sign-in and the pairing link                                  |
| TUI `ui.slot`, `ui.dialog`, `ui.toast`, `data.on` | Sidebar status, progress dialog, sign-in and QR dialogs, notifications   |

What worked well and should stay:

- **Plugin RPC.** Typed calls plus custom events between the two halves. Our first version passed progress and cancel through session metadata, where writes raced and an import wiped them. RPC removed all of that.
- **Commands run while the agent is busy.** That is what makes a mid-answer move possible.
- **Instruction entries** for facts about the session's environment, and the `<env>` block updating itself after a move.
- **Same-ID import.** A moved session looks like the same session everywhere.
- **Native forms.** We didn't have to build our own question UI.

## 3. Bugs

### 3.1 `command.updated` from a plugin never reaches the terminal

`ctx.command.reload()` publishes `Command.Event.Updated` with `{}` ([command.ts:70](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/command.ts#L70)). The bus only adds a location when a `Location.Service` is in context ([bus.ts:512-517](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/bus.ts#L512-L517)), and plugin code runs without one ([plugin.ts:83-87](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/plugin.ts#L83-L87)). The terminal drops events with no location ([data.ts:1392](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/client/src/solid/data.ts#L1392)). So a command a plugin adds at runtime is invisible until restart.

- Workaround: our terminal plugin listens for `command.updated` and calls `location.command.invalidate()` and `sync()` itself.
- Likely the same, untested: `skill.updated` from [skill.ts:159](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/skill.ts#L159), and the `{}` publishes in `agent.ts:90`, `reference.ts:107`, `integration.ts:362` and `websearch.ts:121`.

### 3.2 The terminal leaves a session that is deleted and imported again

Deleting the open session sends the terminal home, or closes the tab. After the same ID is
imported again, the terminal keeps the empty copy it held, even though the server returns every
message.

- Workaround: we poll `ui.router.current()` every 500 ms to know which session is open, and on `session.created` for that ID we invalidate, sync and navigate back.
- There is no route-change event ([tui/context.ts:496](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/plugin/src/tui/context.ts#L496)). `current()` is a Solid store, so a `createEffect` may work, but that isn't documented.
- Still open: if the delete and the import land in the same instant, the tab isn't added back.

  4.5 would remove the need for all of this.

### 3.3 A prompt hook that throws gives an empty 500

When `session.hook("prompt")` throws, the throw becomes a defect ([adapter.ts:632](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/plugin/src/promise/adapter.ts#L632)). The prompt handler returns an empty 500 ([handlers/session.ts:290-315](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/server/src/handlers/session.ts#L290-L315)) and the typed message disappears. We show a form before throwing so the user knows why. A typed rejection with a message the terminal shows would be better.

### 3.4 Form rendering

- A field with no title shows its raw key ([form.ts:16](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/tui/src/util/form.ts#L16)).
- A field's description replaces its title ([form.tsx:885](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/tui/src/routes/session/form.tsx#L885)). With one field there are no tabs, so the question has to go in the form title.
- An `external` field always shows "Open or copy the URL, complete the external action, then confirm" ([form.tsx:875-876](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/tui/src/routes/session/form.tsx#L875-L876)), and only `true` is a valid answer ([form.tsx:128](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/tui/src/routes/session/form.tsx#L128)). For sign-in we needed a code, a QR code and "close to cancel", so our terminal plugin watches `form.created` for our own field key, draws its own dialog on top, and calls `form.cancel` when it closes. A way for a terminal plugin to render a field, or a description that replaces the default line, would remove that.

### 3.5 Background work finishes in a moment where nothing looks busy

When a subagent finishes, its report goes into the parent's inbox ([subagent-report.ts:83](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/execution/subagent-report.ts#L83)), then the job is removed ([subagent-completion.ts:80](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/subagent-completion.ts#L80)), then the parent wakes ([subagent-report.ts:127](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/execution/subagent-report.ts#L127)). In between there is no job, the parent isn't active, and a report is waiting. A client asking "is this session done?" then gets the wrong answer.

Background shells do it the safe way: inbox, wake, then remove the job ([session.ts:311-323](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/session.ts#L311-L323), [shell.ts:173](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/tool/plugin/shell.ts#L173)). Waking the parent before removing the job would make the two match.

### 3.6 Jobs stay `running` forever after a crash on plain `opencode serve`

Tested on 2.3.0: after a `kill -9` and restart, `experimental.job.list` still showed a subagent job
and a shell job as `running` 50 s later. The subagent never resumed and the shell no longer existed.
Only `serve --service` runs the restart sweep ([restart.ts:368](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/execution/restart.ts#L368)), and there the same subagent resumed and finished.

Any client that waits on jobs hangs, `opencode run` included. Running the sweep on plain `serve`, or
settling job rows the new process doesn't own, would fix it. `server.info` is also identical in
both modes, so a client can't tell whether a restart will be recovered.

### 3.7 A config change can unload a plugin in the middle of a command

A config change reloads every plugin from the first changed entry onward ([plugin.ts:122-140](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/plugin.ts#L122-L140)). We hit this for real: `/cloud-return` stashes local changes. If the project's `opencode.json` was uncommitted and lists our plugin, the stash changes our entry, and OpenCode unloads the plugin halfway through the return.

Delaying the reload until running commands finish, or letting a plugin say it is busy, would fix it.

## 4. Improvements that would help every plugin

Ordered by how much code they would have saved us.

### 4.1 Give server plugins the same reach as an HTTP client

- The plugin `session` domain is a `Pick` of the HTTP API with no `export`, `import`, `fork`, `active`, `inbox`, `form` or `job` ([promise/session.ts:219-239](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/plugin/src/promise/session.ts#L219-L239)). The plugin context has no client ([promise/plugin.ts:27-58](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/plugin/src/promise/plugin.ts#L27-L58)), and `ctx.rpc` only reaches methods plugins register, not the server's own API.
- So our server plugin builds a second, authenticated client to its own server, through `Service.discover()` or a `localServerUrl` option.
- Under `opencode --standalone` the server is on a random port ([standalone.ts:20](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/cli/src/services/standalone.ts#L20)) and removes `OPENCODE_SERVER_PASSWORD` from its environment ([server-process.ts:89](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/cli/src/server-process.ts#L89)). There `/cloud` can't work at all, and we tell users to run `opencode serve` themselves.

Proposal: `ctx.client`, an `OpenCodeClient` already bound to the host server and the plugin's
location, like the terminal plugin's `context.client`. Or widen the `Pick`. Either way a plugin
never needs credentials for the server it runs in. This would help any plugin that does backups,
sync, sharing or migration.

### 4.2 One "is this session really idle?" answer

To decide whether a session is busy, we combine `session.active`, `experimental.job.list({ descendants: true })` and `session.inbox.list`, then sort inbox items by `payload.metadata.source`, because a `resume: false` note looks the same as a subagent report that will wake the parent.

OpenCode already computes this as `SessionBackground.outstanding`, but only plugins see it, inside the `experimental.idle` hook ([llm.ts:182-185](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/runner/llm.ts#L182-L185)). The experimental `session.wait` endpoint ([groups/session.ts:462](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/protocol/src/groups/session.ts#L462)) waits for the agent loop only, not jobs or the inbox.

Proposal:

- Expose the outstanding list over HTTP, for example `GET /session/:id/status` returning `{ active, jobs, waking }`, or make `session.wait` cover jobs and the inbox.
- Add a `resume` flag to each inbox item.
- Fix the order in 3.5.

Every SDK user or bot that waits for a run needs this. Our Slack and Discord bots and `opencode run` each rebuild it, with different edge cases.

### 4.3 Stop a session and everything under it

`session.interrupt` stops the parent only ([execution.ts:179-195](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/execution.ts#L179-L195)), and HTTP has `job.list` but no job cancel ([groups/job.ts:32](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/protocol/src/groups/job.ts#L32)). Each stopped subagent then reports back, which wakes the parent again. Our `stopSession` loops: interrupt the parent and every child session, then wait for three quiet checks 200 ms apart, with a 15 s deadline.

Proposal: `session.interrupt({ sessionID, subagents: true })` that stops descendants and holds back their cancellation reports, or a job-cancel endpoint that does the same.

### 4.4 Waiting instead of polling

| What           | We do today                                     | Would rather                                               |
| -------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| A form answer  | `form.get` every 400 ms                         | `form.wait({ formID })`                                    |
| A shell        | `shell.get` every 300 ms                        | `shell.wait({ id })` returning the exit code               |
| Model catalog  | `model.list` until it stops growing, up to 15 s | a "catalog ready" flag in `server.info`                    |
| Terminal route | `router.current()` every 500 ms                 | `router.onChange`, or document that `current()` is a store |

`form.replied`, `form.cancelled` and `shell.exited` events exist, but the shell runs on a remote
server, and waiting on an event means subscribing first and handling a missed one. A wait call is
simpler for every HTTP client. `server.info` has no readiness field even though its description
mentions one.

### 4.5 Replace a session's contents in place

`import` over an existing ID fails with "Session already exists" ([transfer.ts:76](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/transfer.ts#L76)), and message IDs are unique across the server ([sql.ts:89](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/sql.ts#L89)). So to bring a conversation back we delete the session and import it again. That causes 3.2, and a crash between the two steps leaves no session, so we keep a copy in memory to put back.

Proposal: `session.import({ ..., replace: true })` as one transaction, with one `session.updated` event so clients just refresh.

### 4.6 Let plugins tell the agent something at a point in the conversation

Instruction entries give the agent standing facts. What a plugin can't control is when the agent learns them.

- On a session the model has already seen, a changed entry becomes a stored `system` message at that point, sent as `<system-update>` ([shared.ts:225](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/ai/src/protocols/shared.ts#L225)). That is right. On a session with no instruction history on this server, such as one just imported, it only goes into the system prompt, with no place in the conversation (the `initial` case in [instruction-state.ts:44-58](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/instruction-state.ts#L44-L58)).
- A plugin can't add a `system` message itself. `session.synthetic` reaches the model as a `user` message ([to-llm-message.ts:274-275](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/runner/to-llm-message.ts#L274-L275)), so unwrapped it reads as if the user typed it.

What it cost us: after a session came back from the cloud, the agent was asked which machine it
was on. It ran `hostname`, saw the Mac, and called its earlier correct answer ("a Linux cloud
workspace") a mistake. The fact was in its system prompt, but nothing said when it changed. We
now also send a synthetic note wrapped in `<session-moved source="gitterm">` saying it is not from
the user, copying how OpenCode wraps subagent reports. Every plugin would have to invent its own
wrapper.

Any plugin that changes the agent's surroundings mid-session needs this: a worktree or branch
switch, a new secret, a deploy or CI result, a sandbox starting or stopping.

Proposal, any one of:

- `entry.put({ ..., announce: true })`, which always records a `<system-update>` at this point.
- `session.synthetic({ ..., role: "system" })`, or a `session.notice()` sent as `<system-update>`.
- Treat the first entry put after `session.import` as an update, not the baseline.

Each of these adds a message at the end of the conversation, the way OpenCode's own updates
already work. None changes earlier messages or the system prompt, so the prompt cache stays
valid. OpenCode keeps the system prompt fixed on purpose
([instruction-state.ts:142-144](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/instruction-state.ts#L142-L144)).

### 4.7 Smaller ones

- **Forks copy all metadata** ([projector.ts:177](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/projector.ts#L177)) and instruction entries ([session.ts:363-368](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session.ts#L363-L368)). The 2.3 `fork` hook lets us strip our marker. Worth a line in the hook's docs, or a way to mark metadata keys as not forked.
- **Export leaves out instruction entries** ([transfer.ts:61-66](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/transfer.ts#L61-L66)). Right for us, but not documented.
- **Client errors carry `_tag`, not the HTTP status**, for declared errors. A `status` field would help generic handling.
- **Plugins can't register a job kind.** Long plugin work, like our sandbox watches, can't show in the job list and dies on reload.
- **Commands are per project.** `/cloud-return` shows in every session of the checkout ([command.ts:13-17](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/plugin/src/promise/command.ts#L13-L17)). An optional `when(sessionID)` would fix it.
- **RPC before plugins load.** A call that arrives before a project's plugins load fails with `rpc.unavailable` ([rpc.ts:110](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/rpc.ts#L110)) instead of waiting. Worth a note in the RPC docs that callers should retry.
- **Running a script without Node.** We run our restore script locally with `BUN_BE_BUN=1 <opencode binary> -e`. It relies on OpenCode staying a Bun executable. A supported `opencode run-script` would be safer.

## 5. On our side

- The plugin needs OpenCode 2.3.0 or newer, locally for the `fork` hook and in the cloud for instruction entries and `synthetic({ resume })`.
- An uncommitted project `opencode.json` that points at a local plugin path gets copied to the cloud, where it logs a harmless "failed to load plugin".

## 6. How we tested

- Two real `opencode serve` 2.3.0 processes with separate `HOME` and `XDG_*` directories, one acting as the cloud.
- A fake OpenAI-compatible model that streams slowly, so we can stop an agent mid-answer.
- A fake GitTerm API, including device sign-in.
- The real terminal UI, driven through a pseudo-terminal and read from the screen.

Happy to turn any of section 3 or 4 into issues or PRs.
