/** @jsxImportSource solid-js */
/**
 * GitTerm in the OpenCode desktop app: the same UI as the terminal plugin (`tui.tsx`) over the
 * same server plugin. A pill above the composer says where a moved session is and runs /cloud or
 * /cloud-return; a dialog shows each step of a run; the link to the cloud session opens with a
 * QR code for a phone; a notification says when the cloud agent finishes or needs the user.
 */
import { ComposerPill, Plugin } from "@opencode/plugin/gui";
import { createEffect, createSignal, Show, type JSX } from "solid-js";
import { renderSVG } from "uqr";
import {
  CLOUD_KEY,
  CLOUD_RPC,
  CONNECT_KEY,
  SIGN_IN_KEY,
  type CloudMarker,
  type CloudProgress,
  type CloudStatus,
} from "./marker";

const STATES: Record<
  CloudStatus | "unknown",
  { label: string; tone?: "success" | "warning" | "danger" }
> = {
  unknown: { label: "In GitTerm" },
  working: { label: "Working in GitTerm", tone: "success" },
  waiting: { label: "Needs you in GitTerm", tone: "warning" },
  idle: { label: "Idle in GitTerm" },
  paused: { label: "Paused in GitTerm" },
  gone: { label: "Cloud workspace deleted", tone: "danger" },
};

type Session = { id: string; directory: string };

const box: JSX.CSSProperties = {
  display: "flex",
  "flex-direction": "column",
  gap: "12px",
  padding: "20px",
  "max-width": "420px",
};
const muted: JSX.CSSProperties = { opacity: "0.7", margin: "0" };
const row: JSX.CSSProperties = { display: "flex", gap: "8px", "justify-content": "flex-end" };

/** A QR code of `url`, for opening it on a phone. */
function Qr(props: { url: string }) {
  return (
    <div
      style={{
        width: "200px",
        "align-self": "center",
        background: "white",
        padding: "8px",
        "border-radius": "8px",
      }}
      // uqr writes a plain SVG of black and white rectangles from the URL alone.
      innerHTML={renderSVG(props.url, { border: 1 })}
    />
  );
}

export default Plugin.define({
  setup(ctx) {
    const { Button } = ctx.ui;
    const cloud = () => ctx.client.rpc(CLOUD_RPC);

    // The cloud label of each session seen, from its metadata; kept current by its events.
    const [markers, setMarkers] = createSignal(new Map<string, CloudMarker | null>());
    const setMarker = (id: string, marker: CloudMarker | null) =>
      setMarkers((all) => new Map(all).set(id, marker));
    const loading = new Set<string>();
    const marker = (session: Session) => {
      const known = markers().get(session.id);
      if (known !== undefined || loading.has(session.id)) return known ?? undefined;
      loading.add(session.id);
      void ctx.client.session
        .get({ sessionID: session.id }, { signal: ctx.signal })
        .then((info) =>
          setMarker(session.id, (info.metadata?.[CLOUD_KEY] as CloudMarker | undefined) ?? null),
        )
        .catch(() => {})
        .finally(() => loading.delete(session.id));
      return undefined;
    };

    /** Runs the server plugin's command, as typing it in the composer would. */
    const run = (session: Session, name: "cloud" | "cloud-return") =>
      void ctx.client.session
        .command({ sessionID: session.id, name, text: "" })
        .catch((error: unknown) =>
          ctx.toast.show({
            title:
              name === "cloud" ? "Could not open the cloud session" : "Could not bring it back",
            description: error instanceof Error ? error.message : String(error),
            variant: "error",
          }),
        );

    ctx.add(ComposerPill, {
      id: "cloud",
      show(input) {
        const session = { id: input.session.id, directory: input.session.directory };
        const found = marker(session);
        if (!found) return undefined;
        const state = STATES[found.status ?? "unknown"];
        return {
          label: state.label,
          icon: "cloud-upload",
          ...(state.tone ? { tone: state.tone } : {}),
          title: `This session continues in GitTerm workspace ${found.workspaceID}`,
          rows: [
            found.status === "gone"
              ? {
                  id: "new",
                  label: "Start a new cloud workspace",
                  run: () => run(session, "cloud"),
                }
              : { id: "open", label: "Open the cloud session", run: () => run(session, "cloud") },
            { id: "return", label: "Bring it back here", run: () => run(session, "cloud-return") },
          ],
        };
      },
    });

    // Each run's steps arrive from the server plugin. Closing the dialog cancels a run that
    // can be cancelled; otherwise it only hides it.
    const [runs, setRuns] = createSignal(new Map<string, CloudProgress>());
    let progressDialog: { sessionID: string; close(): void } | undefined;
    const hidden = new Set<string>();
    const directories = new Map<string, string>();
    const showProgress = (sessionID: string) => {
      const progress = runs().get(sessionID);
      if (!progress) {
        if (progressDialog?.sessionID === sessionID) progressDialog.close();
        return;
      }
      if (progressDialog || hidden.has(progress.attemptID)) return;
      if (ctx.sessions.current()?.id !== sessionID) return;
      const attempt = { sessionID, attemptID: progress.attemptID };
      const current = () => runs().get(sessionID) ?? progress;
      let handle: { close(): void } | undefined;
      const close = (cancel: boolean) => {
        hidden.add(attempt.attemptID);
        handle?.close();
        if (!cancel || !current().cancellable) return;
        const directory = directories.get(sessionID);
        void cloud()
          .cancel(attempt, directory ? { location: { directory } } : undefined)
          .then(() => ctx.toast.show({ title: "Cancelling…" }))
          .catch(() => ctx.toast.show({ title: "Could not cancel", variant: "error" }));
      };
      handle = ctx.dialogs.open(() => (
        <div style={box}>
          <strong>{current().title}</strong>
          <p style={muted}>{current().step}…</p>
          <div style={row}>
            <Show
              when={current().cancellable}
              fallback={<Button onClick={() => close(false)}>Hide</Button>}
            >
              <Button variant="danger" onClick={() => close(true)}>
                Cancel
              </Button>
            </Show>
          </div>
        </div>
      ));
      progressDialog = {
        sessionID,
        close: () => {
          handle?.close();
          progressDialog = undefined;
        },
      };
    };
    cloud().events.on(
      "progress",
      (event) => {
        const progress = event.data as CloudProgress;
        const next = new Map(runs());
        if (progress.step === undefined) next.delete(progress.sessionID);
        else next.set(progress.sessionID, progress);
        setRuns(next);
        if (progress.step === undefined && progressDialog?.sessionID === progress.sessionID)
          progressDialog.close();
        showProgress(progress.sessionID);
      },
      { signal: ctx.signal },
    );

    /** The link to the cloud session, or to GitTerm's sign-in page, the server plugin asks to open. */
    const showLink = (
      form: { id: string; sessionID: string; title: string },
      url: string,
      signIn: boolean,
    ) => {
      const target = { sessionID: form.sessionID, formID: form.id };
      const paired = url.includes("/auth/connect/");
      const code = signIn ? new URL(url).searchParams.get("code") : undefined;
      let answered = false;
      // Closing the sign-in dialog cancels /cloud; closing the link dialog only dismisses it.
      const done = (handle: { close(): void }) => {
        answered = true;
        handle.close();
        void (
          signIn
            ? ctx.client.session.form.cancel(target)
            : ctx.client.session.form.reply({
                ...target,
                answer: { [CONNECT_KEY]: true, done: true },
              } as Parameters<typeof ctx.client.session.form.reply>[0])
        ).catch(() => {});
      };
      const handle = ctx.dialogs.open((dialog) => (
        <div style={box}>
          <strong>{signIn ? "Sign in to GitTerm" : form.title}</strong>
          <p style={muted}>
            {signIn
              ? "/cloud runs your session on a GitTerm cloud computer. Open the link, sign in or create an account, and approve this code:"
              : paired
                ? "Scan it with your phone, or open it on this computer. It works once, for 5 minutes; /cloud makes a new one."
                : "Open it and sign in with the workspace credential from your GitTerm dashboard."}
          </p>
          <Show when={code}>
            <strong style={{ "align-self": "center", "font-size": "20px" }}>{code}</strong>
          </Show>
          <Qr url={url} />
          <Show when={!signIn}>
            <p style={muted}>
              Billed while it runs. Bring it back from the pill above the composer.
            </p>
          </Show>
          <div style={row}>
            <Button onClick={() => void ctx.system.copy(url)}>Copy link</Button>
            <Button variant="contrast" onClick={() => ctx.system.openExternal(url)}>
              Open
            </Button>
            <Button onClick={() => done(dialog)}>{signIn ? "Cancel" : "Done"}</Button>
          </div>
        </div>
      ));
      return {
        formID: form.id,
        close: () => {
          if (!answered) handle.close();
        },
      };
    };

    // Say so when the cloud agent stops working: it finished, or it is waiting for the user.
    const notify = (before?: CloudStatus, status?: CloudStatus) => {
      const message =
        status === "waiting" && before !== "waiting"
          ? "The cloud agent needs your input."
          : status === "idle" && before === "working"
            ? "The cloud agent finished. Bring it back from the pill above the composer."
            : undefined;
      if (!message) return;
      void ctx.attention.notify({ title: "GitTerm", message });
    };

    // Server events: the labels, the forms that carry a link, and when to notify.
    const shown = new Map<string, { formID: string; close(): void }>();
    void (async () => {
      const events = ctx.client.event.subscribe({
        types: [
          "session.metadata.updated",
          "form.created",
          "form.replied",
          "form.cancelled",
        ] as const,
        signal: ctx.signal,
      });
      for await (const event of events) {
        if (event.type === "session.metadata.updated") {
          const { sessionID, metadata } = event.data;
          const next = (metadata?.[CLOUD_KEY] as CloudMarker | undefined) ?? null;
          const before = markers().get(sessionID)?.status;
          setMarker(sessionID, next);
          notify(before, next?.status);
        } else if (event.type === "form.created") {
          const form = event.data.form;
          // A question asked during a run would sit behind the progress: step aside.
          if (progressDialog?.sessionID === form.sessionID) progressDialog.close();
          const field = form.fields.find(
            (item) =>
              (item.key === CONNECT_KEY || item.key === SIGN_IN_KEY) && item.type === "external",
          );
          if (!field || !("url" in field) || ctx.sessions.current()?.id !== form.sessionID)
            continue;
          shown.set(form.sessionID, showLink(form, field.url, field.key === SIGN_IN_KEY));
        } else if (event.type === "form.replied" || event.type === "form.cancelled") {
          const { id, sessionID } = event.data;
          const link = shown.get(sessionID);
          if (link?.formID === id) {
            shown.delete(sessionID);
            link.close();
          }
          showProgress(sessionID);
        }
      }
    })().catch(() => {});

    // Progress and links are shown only in the session the user is looking at; remember its
    // directory for the server calls those dialogs make.
    createEffect(() => {
      const session = ctx.sessions.current();
      if (!session) return;
      directories.set(session.id, session.directory);
      showProgress(session.id);
    });
  },
});
