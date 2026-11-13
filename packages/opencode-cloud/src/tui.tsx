/** @jsxImportSource @opentui/solid */
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { openUrl } from "@opencode/util/open";
import { renderUnicodeCompact } from "@opencode/util/qr";
import type { RGBA } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import { createSignal, onCleanup, Show } from "solid-js";
import {
  CANCEL_KEY,
  CLOUD_KEY,
  CONNECT_KEY,
  PROGRESS_KEY,
  type CloudMarker,
  type CloudProgress,
  type CloudStatus,
} from "./marker";

type Theme = {
  text: { base: RGBA; muted: RGBA; feedback: Record<"success" | "warning", { base: RGBA }> };
};

const STATES: Record<CloudStatus | "unknown", { label: string; next: string }> = {
  unknown: { label: "Continues in GitTerm", next: "/cloud-return brings it back" },
  working: { label: "Working in GitTerm", next: "/cloud opens it" },
  waiting: { label: "Needs your input in GitTerm", next: "/cloud opens it" },
  idle: { label: "Idle in GitTerm", next: "/cloud-return brings it back" },
  paused: { label: "Paused in GitTerm", next: "/cloud-return brings it back" },
  gone: { label: "Cloud workspace was deleted", next: "/cloud starts a new one" },
};

const markerOf = (metadata: Record<string, unknown> | undefined) =>
  metadata?.[CLOUD_KEY] as CloudMarker | undefined;
const progressOf = (metadata: Record<string, unknown> | undefined) =>
  metadata?.[PROGRESS_KEY] as CloudProgress | undefined;

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function CloudProgressDialog(props: { sessionID: string; step: string }) {
  const context = usePlugin();
  const theme = () => context.theme as unknown as Theme;
  const [frame, setFrame] = createSignal(0);
  const timer = setInterval(() => setFrame((value) => (value + 1) % SPINNER.length), 80);
  onCleanup(() => clearInterval(timer));
  const step = () =>
    progressOf(context.data.session.get(props.sessionID)?.metadata)?.step ?? props.step;
  return (
    <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2} paddingBottom={1}>
      <text fg={theme().text.base}>
        <b>Moving to the cloud</b>
      </text>
      <text fg={theme().text.base}>
        {SPINNER[frame()]} {step()}…
      </text>
      <text fg={theme().text.muted}>Esc cancels</text>
    </box>
  );
}

function useCloud(sessionID: () => string) {
  const context = usePlugin();
  const marker = () => markerOf(context.data.session.get(sessionID())?.metadata);
  return {
    theme: () => context.theme as unknown as Theme,
    marker,
    state: () => STATES[marker()?.status ?? "unknown"],
  };
}

/**
 * /cloud's "ready" form as a dialog: a QR code for a phone, and the link for this computer.
 * The link is a one-time OpenCode pairing link (`/auth/connect/<code>`) when the workspace
 * can make one; OpenCode's app scanner and a phone camera both open it.
 */
function CloudConnectDialog(props: { url: string }) {
  const context = usePlugin();
  const theme = () => context.theme as unknown as Theme;
  const paired = props.url.includes("/auth/connect/");
  const open = () => void openUrl(props.url).catch(() => {});
  useKeyboard((key) => {
    if (key.ctrl || key.meta) return;
    if (key.name === "return") open();
    if (key.name === "c") {
      context.renderer.copyToClipboardOSC52(props.url);
      context.ui.toast.show({ message: "Link copied", variant: "success" });
    }
  });
  return (
    <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2} paddingBottom={1}>
      <text fg={theme().text.base}>
        <b>Your cloud session is ready</b>
      </text>
      <box alignItems="center">
        <text fg={theme().text.base}>{renderUnicodeCompact(props.url, { border: 1 })}</text>
      </box>
      <box flexDirection="column">
        <text fg={theme().text.muted}>
          {paired
            ? "Scan it with your phone, or open the link on this computer."
            : "Open the link and sign in with the workspace credential from your GitTerm dashboard."}
        </text>
        <text fg={theme().text.base} onMouseUp={open}>
          <a href={props.url}>{props.url}</a>
        </text>
        <Show when={paired}>
          <text fg={theme().text.muted}>Works once, for 5 minutes. /cloud makes a new one.</text>
        </Show>
      </box>
      <text fg={theme().text.muted}>enter open c copy esc close</text>
    </box>
  );
}

function CloudSidebar(props: { sessionID: string }) {
  const { theme, marker, state } = useCloud(() => props.sessionID);
  const dot = () =>
    marker()?.status === "working"
      ? theme().text.feedback.success.base
      : theme().text.feedback.warning.base;
  return (
    <Show when={marker()}>
      <box flexDirection="column">
        <text fg={theme().text.base}>
          <b>Cloud</b>
        </text>
        <text fg={theme().text.base}>
          <span style={{ fg: dot() }}>•</span> {state().label}
        </text>
        <text fg={theme().text.muted}> {state().next}</text>
      </box>
    </Show>
  );
}

function CloudBanner(props: { sessionID: string }) {
  const { theme, marker, state } = useCloud(() => props.sessionID);
  return (
    <Show when={marker()}>
      <text fg={theme().text.feedback.warning.base}>
        {state().label}. {state().next}.
      </text>
    </Show>
  );
}

export default Plugin.define({
  id: "gitterm.cloud",
  setup(context) {
    const sidebar = context.ui.slot({
      append: "sidebar.content",
      render: (input) => <CloudSidebar sessionID={input.sessionID} />,
    });
    const banner = context.ui.slot({
      append: "session.composer.top",
      render: (input) => <CloudBanner sessionID={input.sessionID} />,
    });

    // /cloud-return replaces the conversation by deleting the session and importing the cloud's
    // under the same ID. The host leaves a deleted session for the home screen, so return
    // to the session when it reappears.
    let viewing: string | undefined;
    let replaced: { sessionID: string; at: number } | undefined;
    const remember = () => {
      const route = context.ui.router.current();
      if (route.type === "session") viewing = route.sessionID;
    };
    const timer = setInterval(remember, 500);
    const deleted = context.data.on("session.deleted", (event) => {
      remember();
      if (event.data.sessionID === viewing) replaced = { sessionID: viewing, at: Date.now() };
    });
    const created = context.data.on("session.created", (event) => {
      if (event.data.sessionID !== replaced?.sessionID || Date.now() - replaced.at > 60_000) return;
      replaced = undefined;
      const { sessionID } = event.data;
      // What the host held for the deleted session is gone; load the imported conversation.
      context.data.session.invalidate(sessionID);
      context.data.session.message.invalidate(sessionID);
      void Promise.all([
        context.data.session.sync(sessionID),
        context.data.session.message.sync(sessionID),
      ]).finally(() => context.ui.router.navigate({ type: "session", sessionID }));
    });

    let open: { sessionID: string; attemptID: string } | undefined;
    const cancelled = new Set<string>();
    const cancel = async (run: { sessionID: string; attemptID: string }) => {
      const session = await context.client.session.get({ sessionID: run.sessionID });
      await context.client.session.update({
        sessionID: run.sessionID,
        metadata: { ...session.metadata, [CANCEL_KEY]: run.attemptID },
      } as Parameters<typeof context.client.session.update>[0]);
      context.ui.toast.show({ message: "Cancelling /cloud…", variant: "info" });
    };
    const showProgress = (sessionID: string, metadata: Record<string, unknown> | undefined) => {
      const progress = progressOf(metadata);
      if (!progress) {
        if (open?.sessionID !== sessionID) return;
        open = undefined;
        context.ui.dialog.clear();
        return;
      }
      if (open || cancelled.has(progress.attemptID)) return;
      const route = context.ui.router.current();
      if (route.type !== "session" || route.sessionID !== sessionID) return;
      const run = { sessionID, attemptID: progress.attemptID };
      open = run;
      context.ui.dialog.show(
        () => <CloudProgressDialog sessionID={sessionID} step={progress.step} />,
        () => {
          if (open !== run) return;
          open = undefined;
          cancelled.add(run.attemptID);
          void cancel(run).catch(() =>
            context.ui.toast.show({ message: "Could not cancel /cloud.", variant: "error" }),
          );
        },
      );
    };

    // /cloud's "ready" form shows as a dialog. Closing it answers the form, which ends /cloud.
    let connect: { sessionID: string; formID: string } | undefined;
    const formCreated = context.data.on("form.created", (event) => {
      const form = event.data.form;
      const field = form.fields.find(
        (item) => item.key === CONNECT_KEY && item.type === "external",
      );
      if (!field || !("url" in field)) return;
      const route = context.ui.router.current();
      if (route.type !== "session" || route.sessionID !== form.sessionID) return;
      // The progress dialog gives way; being replaced is not a cancel.
      open = undefined;
      const shown = { sessionID: form.sessionID, formID: form.id };
      connect = shown;
      context.ui.dialog.show(
        () => <CloudConnectDialog url={field.url} />,
        () => {
          if (connect !== shown) return;
          connect = undefined;
          void context.data.session.form
            .reply({
              sessionID: shown.sessionID,
              formID: shown.formID,
              answer: { [CONNECT_KEY]: true, done: true },
            } as Parameters<typeof context.data.session.form.reply>[0])
            .catch(() => {});
        },
      );
      context.ui.dialog.set({ size: "large" });
    });
    // The form can also end without the dialog (answered elsewhere, or timed out).
    const formEnded = (event: { data: { id: string } }) => {
      if (!connect || connect.formID !== event.data.id) return;
      connect = undefined;
      context.ui.dialog.clear();
    };
    const formReplied = context.data.on("form.replied", formEnded);
    const formCancelled = context.data.on("form.cancelled", formEnded);

    // Say so when the cloud agent stops working: it finished, or it is waiting for the user.
    const last = new Map<string, CloudStatus | undefined>();
    const changed = context.data.on("session.metadata.updated", (event) => {
      const { sessionID } = event.data;
      showProgress(sessionID, event.data.metadata);
      const status = markerOf(event.data.metadata)?.status;
      const before = last.get(sessionID);
      last.set(sessionID, status);
      const message =
        status === "waiting" && before !== "waiting"
          ? "The cloud agent needs your input. /cloud opens it."
          : status === "idle" && before === "working"
            ? "The cloud agent finished. /cloud-return brings it back."
            : undefined;
      if (!message) return;
      const title = context.data.session.get(sessionID)?.title ?? "Cloud session";
      context.ui.toast.show({ title, message, variant: "info", sessionID });
      void context.attention.notify({ title, message });
    });
    return () => {
      if (open) {
        open = undefined;
        context.ui.dialog.clear();
      }
      clearInterval(timer);
      deleted();
      created();
      changed();
      formCreated();
      formReplied();
      formCancelled();
      sidebar();
      banner();
    };
  },
});
