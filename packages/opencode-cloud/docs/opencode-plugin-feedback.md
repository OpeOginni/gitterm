# Building `/cloud` on the OpenCode plugin system

Notes for the OpenCode team from GitTerm, November 2026. Written against OpenCode 2.2.5 to 2.3.0.

**In one paragraph:** `@gitterm/opencode-cloud` moves a live OpenCode session to a cloud
machine and back. That includes the conversation, the Git checkout and uncommitted changes, and
even an agent that is mid-answer. Everything runs as plugins on the user's machine: one server
plugin and one terminal plugin. The cloud side is a stock OpenCode server driven over HTTP. The
plugin system carried us further than we expected. The friction was mostly about reach. A
server plugin can't do what an HTTP client can, and nothing tells a plugin when background work is
really finished. A plugin also can't tell the agent something at a point in the conversation
without it reading as a user message. Fixing those would help any plugin that does long-running
work or changes the agent's surroundings, not just ours. (We also hadn't found plugin RPC for
talking between a plugin's two halves; it was there all along. See 4.2.)

The architecture and handoff flow are described in [`internals.md`](./internals.md).

---

## 1. What we built

```
 Your machine                          GitTerm API            Cloud workspace
 ┌──────────────────────────┐         ┌────────────┐         ┌────────────────────────┐
 │ Terminal  (tui plugin)   │         │ create     │         │ OpenCode server        │
 │ OpenCode server          │────────▶│ wake       │────────▶│ (stock, no plugin)     │
 │   (server plugin)        │         │ delete     │         │ restored Git checkout  │
 │ Git checkout             │════════════════════════════════▶ same session ID       │
 └──────────────────────────┘     HTTP: file.write, shell,    └────────────────────────┘
                                  session.import, prompt
```

**`/cloud [message]`**

1. Asks one question, and only if `git status` shows changes: bring them or not.
2. If the agent is running, interrupts it and every subagent until they stay stopped.
3. Packs the checkout (a Git bundle, patches and new files) and exports the session.
4. Creates a workspace through GitTerm.
5. Uploads the snapshot with `file.write` and restores it with a script run through `shell.create`.
6. Imports the session under the **same ID**.
7. Adds an instruction entry ("you changed machines").
8. Restarts the agent with `prompt` (your message) or `synthetic({ resume: true })` (continue where you stopped).
9. Shows a QR pairing link in a terminal dialog.

**`/cloud-return`** does the reverse:

1. Asks what happens to the workspace.
2. Checks the cloud agent is at rest.
3. Captures only what the cloud added.
4. Applies it locally, asking first if local work would be replaced and keeping it in a stash and a branch.
5. Replaces the local conversation with the cloud's (delete, then import under the same ID).
6. Deletes, snapshots or pauses the workspace.

**While a session is in the cloud**, the terminal sidebar shows whether its agent is working,
waiting for input, idle or paused, and a toast fires when it finishes.

## 2. The plugin APIs we lean on

| API                                                                             | What we use it for                                                               |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `Plugin.define` + `options`                                                     | Server and terminal halves from one package (`exports["."]`, `exports["./tui"]`) |
| `ctx.command.transform` / `reload`                                              | `/cloud` always, `/cloud-return` only while a session is in the cloud            |
| `CommandInvocation.prompt.text`                                                 | `/cloud finish the migration` sends that text to the cloud agent                 |
| `ctx.session.hook("prompt")`                                                    | Asks before a message typed locally forks a conversation that lives in the cloud |
| `ctx.session.hook("fork")` (2.3)                                                | Strips our cloud marker from forks                                               |
| `ctx.storage` get/set/scan                                                      | One small record per moved session                                               |
| `ctx.event.subscribe`                                                           | Watching for the terminal's cancel signal                                        |
| `session.instructions.entry.put` (2.3)                                          | "You moved machines", which survives compaction, unlike a message                |
| `session.synthetic({ resume })`                                                 | Restarting a stopped agent with a note                                           |
| `session.export` / `import`                                                     | Moving the conversation, keeping the ID                                          |
| `form.create` with `external` fields                                            | Questions, and the pairing link                                                  |
| TUI `ui.slot`, `ui.dialog`, `ui.toast`, `data.on`, `router`, `attention.notify` | Sidebar status, progress dialog, QR dialog, notifications                        |

**What worked well and should stay:**

- **Commands run while the agent is busy.** That is what makes a mid-answer move possible.
- **Instruction entries.** These are the right tool for "facts about this session's environment".
- **The `<env>` block updates itself** when the session moves. We did nothing.
- **Same-ID import.** It makes a moved session feel like the same session everywhere.
- **Native forms.** These kept us from building our own question UI, which the first version did, and it showed the question twice.

## 3. Bugs we hit

Each one is reproducible. The source references are against OpenCode `main` as of Nov 15, 2026.

### 3.1 `command.updated` has no location, so the terminal ignores it

`ctx.command.reload()` publishes `Command.Event.Updated` with `{}` (`packages/core/src/command.ts:70`).
The terminal's data layer drops any event without a location (`packages/client/src/solid/data.ts:1392`).
A plugin that adds a command at runtime is invisible until the user restarts.
**Workaround:** our terminal plugin listens for `command.updated` and calls `location.command.invalidate()` and `sync()` itself.
**Likely the same:** `agent.ts:90`, `reference.ts:107`, `integration.ts:362`, `websearch.ts:121` and `artifact.ts:263` publish `{}` the same way. We haven't tested those.

### 3.2 The terminal leaves a session that is removed and re-imported

Deleting the open session sends the terminal home. With vertical tabs, it closes the tab and
switches to another one. After the same ID is imported again, the terminal keeps showing the
empty copy it held, even though the server returns every message.
**Workaround:** `tui.tsx` polls `ui.router.current()` every 500 ms (we found no route-change event). It remembers the session being viewed, and on `session.created` for that ID it invalidates, syncs and navigates back.
**Still open:** if the delete and the import land in the same instant, the tab isn't re-added.

### 3.3 A prompt-hook rejection is silent

When `session.hook("prompt")` throws, the client gets an HTTP 500 with an empty body and the
typed message just disappears. We show a form before rejecting, so the user knows why.

### 3.4 Small form rendering issues (2.3.0)

- A field with no title shows its raw key, for example "changes".
- A boolean field's description replaces its title.
- For a single-question form, the terminal shows the form title and not the field title, so the question has to go in the form title.

### 3.5 Background work finishes in a window where nothing looks busy

When a subagent finishes, its report goes into the parent's inbox, **then** the job is removed,
**then** the parent wakes. For a moment there is no job, the parent isn't active, and a report is
waiting. Any client checking "is this session done?" in that window gets the wrong answer.
Background shells do it in the opposite order (wake first), which is safe.

### 3.6 A rebuilt or reloaded plugin loses its in-flight work

A config change hot-reloads plugins. That is great in development, but it kills anything a
plugin was doing mid-command. We hit this for real: `/cloud-return` stashes local changes. If
the project's `opencode.json` was uncommitted, the stash changes the config, and OpenCode
unloads our plugin halfway through the return.

## 4. Improvements that would help every plugin

Ordered by how much code they would have saved us.

### 4.1 Give server plugins the same reach as an HTTP client

**The problem:**

- The plugin `session` domain is a `Pick` of the HTTP API. It has no `export`, `import`, `fork`, `active`, `inbox`, `form` or `job` access (`plugin/dist/promise/session.d.ts:206`).
- So our server plugin builds a second, authenticated client to **its own server**, through `Service.discover()` or a `localServerUrl` option.
- Under `opencode --standalone` the server is on a random port and removes `OPENCODE_SERVER_PASSWORD` from its environment (`packages/cli/src/server-process.ts:89`). There, `/cloud` cannot work at all. We can only tell users to run `opencode serve` themselves.

**Who else benefits:** any plugin that needs more than the curated subset: backups, sync, session sharing, migration, analytics.

**Proposal:** `ctx.client`, an `OpenCodeClient` already bound to the host server and the plugin's location. Or widen the `Pick`. Either way, a plugin never needs credentials for the server it runs in.

### 4.2 Make plugin RPC easy to find

**What happened:** for months our two halves talked through session metadata.

- The server wrote a progress key, and the terminal showed a dialog.
- The terminal wrote a cancel key, and the server watched `session.metadata.updated`.
- Metadata updates replace the whole object (read, merge, write), so two writers could race.
- Importing a session replaced its metadata, which once wiped the progress dialog mid-run.

Typed RPC with custom events (#46105, there since 2.2.6) was the answer all along; we just
didn't find it. We have now moved to it:

- The server plugin calls `ctx.rpc.register(CLOUD_RPC, { cancel })` and reports each step with `events.emit("progress", ...)`.
- The terminal plugin calls `context.client.rpc(CLOUD_RPC)`, listens with `events.on("progress", ...)` and cancels with `.cancel(...)`.
- It removed the metadata keys and the code that carried them through a session swap.

**What would help others find it:**

- A "server plugin to terminal plugin" example in the plugin docs, since it's the natural use.
- A note that a call made before a project's plugins load fails with `rpc.unavailable`, and should be retried. We hit this in a standalone test, where the first call came right after the server started.

### 4.3 One "is this session really idle?" answer

**The problem:** to decide whether a session is busy, we combine three calls:

- `session.active`
- `experimental.job.list({ descendants: true })`
- `session.inbox.list`

We then classify inbox items by `payload.metadata.source`, because a `resume: false` note looks the same as a subagent report that will wake the parent. `SessionBackground.outstanding` exists, but only inside the `experimental.idle` hook.

**Proposal:**

- `GET /session/:id/status` returns `{ active, jobs, waking: InboxItem[] }`, or the outstanding list over HTTP.
- A `wakes` or `resume` flag on each inbox item.
- Fix the ordering in 3.5.

**Who else benefits:** every SDK user or bot that waits for a run to finish. We hit the same issue in our Slack and Discord bots.

### 4.4 Stop a session and everything under it

**The problem:** `session.interrupt` stops the parent only, and subagents keep running. A
stopped subagent then reports back, which wakes the parent again. Our `stopSession` loops:
interrupt the parent and every subagent's child session, then wait for three quiet checks
200 ms apart, with a 15 s deadline.

**Proposal:** `session.interrupt({ sessionID, tree: true })`, which stops descendants and holds back cancellation reports. Or an HTTP job-cancel endpoint (only `job.list` exists today).

### 4.5 Waiting instead of polling

We poll in three places, and each has an event or a long-poll we would rather await:

| What            | Poll today                                      | Would rather                                                        |
| --------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| A form answer   | `form.get` every 400 ms                         | `form.wait({ formID, signal })`, or `form.create` returns a promise |
| A shell command | `shell.get` every 300 ms                        | `shell.wait({ id })` returning the exit code                        |
| Model catalog   | `model.list` until it stops growing, up to 15 s | a "catalog ready" flag in `server.info`                             |
| Terminal route  | `router.current()` every 500 ms                 | `router.onChange`                                                   |

### 4.6 Replace a session's contents in place

**The problem:** `import` over an existing ID fails with "Session already exists", and message IDs
are unique across the server. So to bring a conversation back, we delete the session and import
it again. That causes the terminal trouble in 3.2, and it means a crash between the two steps
leaves no session. We keep a copy in memory to put back.

**Proposal:** `session.import({ ..., replace: true })` as one transaction, with one `session.updated` event so clients just refresh.

### 4.7 Let plugins tell the agent something at a point in the conversation

**The problem:** plugins can easily give the agent _standing_ facts with instruction entries
(`session.instructions.entry.put`). What they can't control is _when the agent learns them_.

- **Where an entry lands depends on the session's history.** On a session the model has already seen, a new or changed entry becomes a stored `system` message at that point, sent as `<system-update>`. That is the right result. On a session with no instruction history on this server, such as one just imported, it goes only into the system prompt, with no position in the conversation (`InstructionState.commit`, the `initial` case).
- **A plugin can't add a `system` message itself.** Its only way into the conversation is `session.synthetic`, which reaches the model as a plain `user` message (`to-llm-message.ts`, `case "synthetic"`). Unwrapped, it reads as if the user had typed it.

**What it cost us:** after moving a session back from the cloud, the agent was asked which machine
it was on. It ran `hostname`, saw the Mac, and called its own earlier and correct answer, "a Linux
cloud workspace", a mistake, with an apology. The fact was in its system prompt, but nothing said
when it changed. We now send the entry and also a synthetic note wrapped in
`<session-moved source="gitterm">` with "A notice from GitTerm, not a message from the user". That
copies how OpenCode wraps its own subagent reports. It works, but every plugin would have to
invent its own wrapper.

**Who else benefits:** any plugin that changes the agent's surroundings mid-session, such as a
worktree or branch switch, a new environment or secret, a deploy or CI result, or a sandbox
starting or stopping. Each needs "from now on, X is true" placed at the right point and marked as
not coming from the user.

**Proposal**, any one of:

- `entry.put({ ..., announce: true })`: always record a `<system-update>` at this point, even on an initial sync.
- `session.synthetic({ ..., role: "system" })`, or a `session.notice()` that is sent wrapped as `<system-update>`.
- Treat the first entry put after `session.import` as a timeline update, not the baseline.

### 4.8 Smaller ones

- **Forked metadata.** `session.fork` copies all metadata. Plugins that use metadata as a marker need the fork hook to strip it. That's fine, but worth documenting, or let a plugin mark keys as non-forkable.
- **Instruction entries and export.** Export and import leave instruction entries out. That's right for us, but it isn't documented.
- **Error types.** Client errors carry `_tag` (for example `SessionNotFoundError`), not the HTTP status. A `status` field would help generic error handling.
- **Plugins in background jobs.** A plugin can't register its own job kind, so long work like our sandbox watches can't show up in the job list, and dies on reload. A plugin job type would give users one place to see background work.
- **Commands per session.** Commands are per project. `/cloud-return` appears in every session of the checkout, and we say "this session is not in the cloud" in the others. An optional `when(sessionID)` on a command would fix it.
- **Plugin reload during a command.** Warn, delay the reload until running commands finish, or give the plugin a way to say it is busy.
- **Running a script without Node.** We run our restore script locally with `BUN_BE_BUN=1 <opencode binary> -e`. That works, but it relies on OpenCode staying a Bun executable. A supported `opencode run-script` would be safer.
- **Plugin loading notes:**
  - `serve --service` ignores plugins in a project's `.opencode/opencode.json` (seen on 2.2.5).
  - A plugin loaded by path needed a symlinked `node_modules` to resolve `@opencode/plugin`.
- **Docs:** there was no terminal plugin page when we started (2.2.5). We learned slots and theme types from a community plugin. `context.theme` is typed loosely enough that we cast it.

## 5. Things on our side

Not OpenCode's fault, but you may hear about them:

- An uncommitted project `opencode.json` that points at a local plugin path gets copied to the cloud, where it logs a harmless "failed to load plugin".
- The cloud workspace needs OpenCode 2.3+ for instruction entries and `synthetic({ resume })`.

## 6. How we tested

- **Two real `opencode serve` processes** (2.3.0) with separate `HOME` and `XDG_*` directories, one acting as the cloud.
- **A fake OpenAI-compatible model** that streams slowly, so we can stop an agent mid-answer.
- **A fake GitTerm API.**
- **The real terminal UI**, driven through a pseudo-terminal and screen-scraped. Some numbers from the last round:

| Scenario                                         | Before             | After                           |
| ------------------------------------------------ | ------------------ | ------------------------------- |
| `/cloud` on a clean checkout                     | 2 questions, 6.9 s | 0 questions, 3.9 s              |
| `/cloud` while the agent works                   | refused            | stopped, continues in the cloud |
| `/cloud` after a `!shell`                        | refused            | moves                           |
| `/cloud-return` progress dialog shown to the end | 0 of 6 runs        | 6 of 6 runs                     |

Happy to turn any of section 3 or 4 into issues or PRs.
