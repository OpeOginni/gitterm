/** @jsxImportSource @opentui/solid */
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import type { RGBA } from "@opentui/core";
import { Show } from "solid-js";
import { CLOUD_KEY, type CloudMarker, type CloudStatus } from "./marker";

/**
 * Labels a session that /cloud moved to a GitTerm workspace: a block in the sidebar and a
 * line above the prompt, saying what its cloud side is doing. It only reads the marker the
 * server part of this plugin keeps on the session.
 */

/** The parts of the host theme (`@opencode/theme/tui`) used here. */
type Theme = {
  text: { base: RGBA; muted: RGBA; feedback: Record<"success" | "warning", { base: RGBA }> };
};

/** What to say for each state, and which command helps next. */
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

function useCloud(sessionID: () => string) {
  const context = usePlugin();
  const marker = () => markerOf(context.data.session.get(sessionID())?.metadata);
  return {
    theme: () => context.theme as unknown as Theme,
    marker,
    state: () => STATES[marker()?.status ?? "unknown"],
  };
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
      clearInterval(timer);
      deleted();
      created();
      changed();
      sidebar();
      banner();
    };
  },
});
