# Internals

Notes for people working on this plugin: how things work, and why they work that way.

## Architecture

The package ships two plugins, both running on the user's machine:

- `dist/index.js` runs in the local OpenCode server. It registers commands, asks questions,
  transfers the checkout and conversation, and manages the workspace through the GitTerm API.
- `dist/tui.js` runs in the terminal. It displays progress, pairing links and QR codes,
  cloud status, and notifications.

The cloud workspace runs stock OpenCode, without this plugin. The local server plugin drives
it through its HTTP API after GitTerm supplies its URL and password.

The two plugins communicate through the `gitterm.cloud` plugin RPC channel. The server emits
progress events; the terminal calls back to cancel an attempt. Questions use native OpenCode
forms. The server writes cloud status to session metadata for the terminal to display.

The plugin keeps no move state of its own. The shared flows in `@gitterm/move` record each
move in `~/.config/gitterm/moves.json`, the same records the `gitterm` CLI reads and writes,
so a session moved with either is known to both. They hold the workspace ID and the digests
used to detect changes, never checkout snapshots or credentials.

## Moving to the cloud

1. `src/index.ts` handles `/cloud` and reads any following text as a message for the cloud agent.
2. `src/handoff.ts` asks whether to include uncommitted changes, if there are any.
   It interrupts a working agent and its subagents, waiting until they stay quiet.
3. It captures the checkout as a Git bundle, patches and untracked files, with secret-file
   checks, and exports the conversation. It checks that the conversation did not change
   while being copied.
4. It creates a workspace through GitTerm with an idempotency key for the attempt.
   Configured `envFiles` supply environment variables. GitTerm starts the workspace and
   returns access to its OpenCode server.
5. It uploads the checkout snapshot and runs the restore script in the cloud, then imports
   the conversation under the same session ID and tells the agent it changed machines.
6. It sends the supplied message, or a continue note if it interrupted a working agent.
   A pairing link lets the user open the cloud session in a browser.

If the move fails or is cancelled, the plugin deletes the workspace it created and resumes
an agent it stopped locally. `src/status.ts` watches a ready cloud session using passive
requests, without waking a paused workspace or keeping an idle one awake.

## Returning locally

1. `src/return.ts` asks what to do with the workspace after returning: delete, pause, or
   save a project snapshot and delete, where supported. This happens before changing local work.
2. It refuses to return a cloud session that is still working. Otherwise, it exports the
   conversation and captures the cloud checkout relative to the commit originally handed off.
3. It restores the checkout locally. If local work changed since handoff, it asks before
   replacing it and preserves that work in a stash and backup branch.
4. If the cloud conversation changed, it replaces the local session by deleting and importing
   under the same ID. A diverged local conversation gets a fork first. The terminal plugin
   restores navigation after the replacement.
5. It tells the agent it is local again, applies the chosen workspace action, and clears
   the cloud status.

`src/index.ts` offers `/cloud-return` while a session in the project is in the cloud.
Its prompt hook asks before sending a local message to a cloud-linked session.
Its fork hook clears inherited cloud metadata so a copied session is not treated as remote.

For OpenCode API limitations and the workarounds behind these steps, see
[`opencode-plugin-feedback.md`](./opencode-plugin-feedback.md).

## How the agent learns it moved

When `/cloud` or `/cloud-return` moves a session, the agent has to know two things:

1. **Which machine it is on now.** This is the working directory, what came along and what didn't.
2. **When the move happened.** Without this, it reads its own earlier answers about the other machine as mistakes.

We found the second one the hard way. After a return, the agent was asked "Which machine are you running in now?". It ran `hostname`, saw the Mac, and answered "My previous answer was incorrect; I'm sorry". The previous answer, "a Linux cloud workspace", had been right when it was given.

### What we send

Both are sent by `tellMoved()` in `src/handoff.ts`, which both directions call.

|                     | Instruction entry                                          | Note in the conversation                                                |
| ------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| API                 | `session.instructions.entry.put({ key: "gitterm-moved" })` | `session.synthetic({ resume: false, metadata: { source: "gitterm" } })` |
| Gives the agent     | which machine it is on                                     | when the move happened                                                  |
| Survives compaction | yes, entries are sent with every request                   | no, it gets summarised like any message                                 |
| When                | every move                                                 | only when the session was just imported (see below)                     |
| Text                | the move facts                                             | the same facts, wrapped in `<session-moved>`                            |

The note reaches the model like this:

```
<session-moved source="gitterm">
A notice from GitTerm, not a message from the user.
This session moved back from a GitTerm cloud workspace to the user's machine (local checkout …).
Messages from before this move … ran in the cloud workspace under …. What you said in them about
the machine, paths or environment was true then; it is not a mistake.
…
</session-moved>
```

The text itself is written in `handoffSession()` for the move to the cloud and in `returnSession()`
(`src/return.ts`) for the way back. Change it there, not here.

### Why both, and why the note only after an import

Where OpenCode puts an instruction entry depends on the session's history on that server. This was verified on 2.3.0; see `InstructionState.commit` in OpenCode's `packages/core/src/session/instruction-state.ts`.

- **A session the model has already seen there.** A new or changed entry becomes a stored `system` message at that point in the conversation. The model gets it as `<system-update>…</system-update>`, which places it in time and marks it as coming from the system.
- **A session that was just imported.** OpenCode has no instruction history for it ("initial"), so the entry only goes into the system prompt. It has no position in the conversation. This is the case that produced the apology.

When each case happens:

| Move                                          | Session imported?                                 | So the agent gets                                                                        |
| --------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `/cloud`                                      | always, the cloud gets a fresh import             | entry in the system prompt, plus the note                                                |
| `/cloud-return`, cloud conversation changed   | yes, local is deleted and the cloud's is imported | entry in the system prompt, plus the note                                                |
| `/cloud-return`, nothing changed in the cloud | no, the local session is kept                     | entry as a `<system-update>` in the conversation, so no note, which would only repeat it |

`returnSession()` passes `replaced` (whether it imported) as `imported`, and `/cloud` always passes `true`.

### Why the note is wrapped

A plugin can't add a `system` message itself. Its only way to put something in the conversation is `session.synthetic`. OpenCode sends synthetic notes to the model as plain `user` messages: see `case "synthetic"` in `packages/core/src/session/runner/to-llm-message.ts`. Unwrapped, the note would read as if the user had typed it.

OpenCode deals with this for its own notices by wrapping them in a tag that names where they came from. Subagent reports arrive as `<subagent …>`, and summaries as `<conversation-checkpoint>`. We do the same with `<session-moved source="gitterm">` and a first line saying it is not from the user.

### Things this relies on (OpenCode 2.3.0)

- **The terminal doesn't show synthetic notes.** The user never sees the note as one of their messages.
- **A `resume: false` note doesn't start the agent.** It waits in the session inbox and goes to the model with the next prompt, right before it. With `/cloud <message>` or a mid-answer move, it is delivered just before the message or the "continue where you left off" note.
- **Busy checks ignore our note.** `sessionBusy()` only counts inbox items that wake the agent: messages, compactions and subagent reports. A note with `source: "gitterm"` waiting in the cloud inbox doesn't block `/cloud-return`.
- **Session export leaves out instruction entries and undelivered inbox items.** Each side only has the entry it was given, and a note the cloud agent never received doesn't come back.

### Other notes we send, not wrapped

These are the ones that restart the agent. They read as instructions, so they aren't wrapped, but they also reach the model with the `user` role:

- `CONTINUE_TEXT` in `src/handoff.ts`, sent with `resume: true` after a mid-answer move: "You were moved to a cloud workspace while working. Continue where you left off."
- "Moving to the cloud was stopped. Continue where you left off.", sent with `resume: true` locally when a move that stopped the agent fails or is cancelled.

### How to check it

Unit tests (`src/handoff.test.ts`) check that the note is sent, what it contains, and its order relative to the message or continue note. To see what a model actually receives:

1. Run two `opencode serve` processes, one as the cloud, with separate `HOME`/`XDG_*` directories and `OPENCODE_SERVER_PASSWORD`.
2. Configure an OpenAI-compatible fake model that logs each request's `messages`, including the system prompt.
3. Do a round trip: `/cloud <message>`, then `/cloud-return`, then ask something locally.
4. In the logged request for that question, check that:
   - the system prompt contains `<context key="gitterm-moved">` saying it moved back;
   - the messages contain both `<session-moved>` notes, each at the point of its move.
