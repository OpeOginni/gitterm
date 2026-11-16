/** @jsxImportSource @opentui/solid */
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { openUrl } from "@opencode/util/open";
import { renderUnicodeCompact } from "@opencode/util/qr";
import type { RGBA } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import { createSignal, onCleanup, Show } from "solid-js";
import {
  CLOUD_KEY,
  CLOUD_RPC,
  CONNECT_KEY,
  SIGN_IN_KEY,
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

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function CloudProgressDialog(props: { progress: () => CloudProgress }) {
  const context = usePlugin();
  const theme = () => context.theme as unknown as Theme;
  const [frame, setFrame] = createSignal(0);
  const timer = setInterval(() => setFrame((value) => (value + 1) % SPINNER.length), 80);
  onCleanup(() => clearInterval(timer));
  const progress = props.progress;
  return (
    <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2} paddingBottom={1}>
      <text fg={theme().text.base}>
        <b>{progress().title}</b>
      </text>
      <text fg={theme().text.base}>
        {SPINNER[frame()]} {progress().step}…
      </text>
      <text fg={theme().text.muted}>{progress().cancellable ? "Esc cancels" : "Esc hides"}</text>
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

function CloudConnectDialog(props: { url: string; title: string }) {
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
        <b>{props.title}</b>
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
        <text fg={theme().text.muted}>Billed while it runs. /cloud-return brings it back.</text>
      </box>
      <text fg={theme().text.muted}>
        <span style={{ fg: theme().text.base }}>enter</span>
        {" open    "}
        <span style={{ fg: theme().text.base }}>c</span>
        {" copy    "}
        <span style={{ fg: theme().text.base }}>esc</span>
        {" close"}
      </text>
    </box>
  );
}

function SignInDialog(props: { url: string }) {
  const context = usePlugin();
  const theme = () => context.theme as unknown as Theme;
  const code = new URL(props.url).searchParams.get("code");
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
        <b>Sign in to GitTerm</b>
      </text>
      <text fg={theme().text.muted}>
        /cloud runs your session on a GitTerm cloud computer. Open the link, sign in or create an
        account, and approve this code:
      </text>
      <box alignItems="center">
        <text fg={theme().text.base}>
          <b>{code}</b>
        </text>
      </box>
      <box alignItems="center">
        <text fg={theme().text.base}>{renderUnicodeCompact(props.url, { border: 1 })}</text>
      </box>
      <box flexDirection="column">
        <text fg={theme().text.base} onMouseUp={open}>
          <a href={props.url}>{props.url}</a>
        </text>
        <text fg={theme().text.muted}>
          This closes by itself once you approve, and /cloud carries on.
        </text>
      </box>
      <text fg={theme().text.muted}>
        <span style={{ fg: theme().text.base }}>enter</span>
        {" open    "}
        <span style={{ fg: theme().text.base }}>c</span>
        {" copy    "}
        <span style={{ fg: theme().text.base }}>esc</span>
        {" cancel"}
      </text>
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
    // under the same ID. The host leaves a deleted session, for the home screen or another
    // open tab, so load the imported conversation and go back to it when it reappears.
    // The host may switch away before this hears of the deletion: the session seen just
    // before the switch counts as the one being viewed.
    let viewing: string | undefined;
    let previous: string | undefined;
    let switched = 0;
    const remember = () => {
      const route = context.ui.router.current();
      if (route.type !== "session" || route.sessionID === viewing) return;
      previous = viewing;
      viewing = route.sessionID;
      switched = Date.now();
    };
    const timer = setInterval(remember, 500);
    const replaced = new Map<string, { at: number; viewed: boolean }>();
    const deleted = context.data.on("session.deleted", (event) => {
      const { sessionID } = event.data;
      const viewed =
        sessionID === viewing || (sessionID === previous && Date.now() - switched < 2_000);
      replaced.set(sessionID, { at: Date.now(), viewed });
    });
    const created = context.data.on("session.created", (event) => {
      const { sessionID } = event.data;
      const entry = replaced.get(sessionID);
      replaced.delete(sessionID);
      if (!entry || Date.now() - entry.at > 60_000) return;
      // What the host held for the deleted session is gone; load the imported conversation.
      context.data.session.invalidate(sessionID);
      context.data.session.message.invalidate(sessionID);
      void Promise.all([
        context.data.session.sync(sessionID),
        context.data.session.message.sync(sessionID),
      ]).finally(() => {
        if (!entry.viewed) return;
        context.ui.router.navigate({ type: "session", sessionID });
        showProgress(sessionID);
      });
    });

    // Each run's steps arrive from the server plugin; Esc asks it to cancel the run.
    const cloud = context.client.rpc(CLOUD_RPC);
    const [runs, setRuns] = createSignal(new Map<string, CloudProgress>());
    let open: { sessionID: string; attemptID: string } | undefined;
    const cancelled = new Set<string>();
    const cancel = async (run: { sessionID: string; attemptID: string }) => {
      const directory = context.data.session.get(run.sessionID)?.location.directory;
      await cloud.cancel(run, { location: directory ? { directory } : undefined });
      context.ui.toast.show({ message: "Cancelling…", variant: "info" });
    };
    const showProgress = (sessionID: string) => {
      const progress = runs().get(sessionID);
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
        () => <CloudProgressDialog progress={() => runs().get(sessionID) ?? progress} />,
        () => {
          if (open !== run) return;
          open = undefined;
          // Dismissed: it stays hidden for the rest of the run.
          cancelled.add(run.attemptID);
          if (!progress.cancellable) return;
          void cancel(run).catch(() =>
            context.ui.toast.show({ message: "Could not cancel.", variant: "error" }),
          );
        },
      );
    };
    const stopProgress = cloud.events.on("progress", (event) => {
      const progress = event.data as CloudProgress;
      const next = new Map(runs());
      if (progress.step === undefined) next.delete(progress.sessionID);
      else next.set(progress.sessionID, progress);
      setRuns(next);
      showProgress(progress.sessionID);
    });
    // A question asked during a run would sit behind the dialog: step aside until it is answered.
    const hideProgress = (sessionID: string) => {
      if (open?.sessionID !== sessionID) return;
      open = undefined;
      context.ui.dialog.clear();
    };

    let connect: { sessionID: string; formID: string } | undefined;
    const formCreated = context.data.on("form.created", (event) => {
      const form = event.data.form;
      hideProgress(form.sessionID);
      const field = form.fields.find(
        (item) =>
          (item.key === CONNECT_KEY || item.key === SIGN_IN_KEY) && item.type === "external",
      );
      if (!field || !("url" in field)) return;
      const route = context.ui.router.current();
      if (route.type !== "session" || route.sessionID !== form.sessionID) return;
      const shown = { sessionID: form.sessionID, formID: form.id };
      connect = shown;
      const signIn = field.key === SIGN_IN_KEY;
      context.ui.dialog.show(
        () =>
          signIn ? (
            <SignInDialog url={field.url} />
          ) : (
            <CloudConnectDialog url={field.url} title={form.title} />
          ),
        () => {
          if (connect !== shown) return;
          connect = undefined;
          // Closing the sign-in dialog cancels /cloud.
          void context.data.session.form
            .reply({
              sessionID: shown.sessionID,
              formID: shown.formID,
              answer: signIn ? { [SIGN_IN_KEY]: true } : { [CONNECT_KEY]: true, done: true },
            } as Parameters<typeof context.data.session.form.reply>[0])
            .catch(() => {});
        },
      );
      context.ui.dialog.set({ size: "large" });
    });
    const formEnded = (event: { data: { id: string; sessionID: string } }) => {
      showProgress(event.data.sessionID);
      if (!connect || connect.formID !== event.data.id) return;
      connect = undefined;
      context.ui.dialog.clear();
    };
    const formReplied = context.data.on("form.replied", formEnded);
    const formCancelled = context.data.on("form.cancelled", formEnded);

    // /cloud and /cloud-return add or remove /cloud-return with a command reload. OpenCode
    // sends that change without a project, so the terminal keeps its old list: fetch it again.
    const commands = context.data.on("command.updated", () => {
      context.data.location.command.invalidate();
      void context.data.location.command.sync().catch(() => {});
    });

    // Say so when the cloud agent stops working: it finished, or it is waiting for the user.
    const last = new Map<string, CloudStatus | undefined>();
    const changed = context.data.on("session.metadata.updated", (event) => {
      const { sessionID } = event.data;
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
      if (open || connect) {
        open = undefined;
        connect = undefined;
        context.ui.dialog.clear();
      }
      clearInterval(timer);
      stopProgress();
      deleted();
      created();
      changed();
      formCreated();
      formReplied();
      formCancelled();
      commands();
      sidebar();
      banner();
    };
  },
});
