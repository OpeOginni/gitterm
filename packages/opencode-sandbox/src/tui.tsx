/** @jsxImportSource @opentui/solid */
import { realpath } from "node:fs/promises";
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import type { RGBA } from "@opentui/core";
import { createFileSandboxStore } from "@gitterm/sdk/sandbox/store";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { sidebarRows, truncate, type SidebarRow } from "./sidebar";

/**
 * Lists this checkout's live sandboxes in the session sidebar. It reads the local records
 * the sandbox tools keep; it never calls a provider or touches credentials.
 */

const REFRESH_MS = 3000;
const WIDTH = 34;

/** The parts of the host theme (`@opencode/theme/tui`) used here. */
type Theme = {
  text: {
    base: RGBA;
    muted: RGBA;
    feedback: Record<"success" | "warning" | "error", { base: RGBA }>;
  };
};

function SandboxSidebar(props: { sessionID: string }) {
  const context = usePlugin();
  const theme = () => context.theme as unknown as Theme;
  const [rows, setRows] = createSignal<SidebarRow[]>([]);

  onMount(() => {
    const store = createFileSandboxStore();
    let disposed = false;
    const refresh = async () => {
      const directory = context.data.session.get(props.sessionID)?.location.directory;
      if (!directory) return;
      const project = await realpath(directory).catch(() => directory);
      const next = sidebarRows(await store.list(), project);
      if (!disposed) setRows(next);
    };
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    onCleanup(() => {
      disposed = true;
      clearInterval(timer);
    });
  });

  const dot = (state: SidebarRow["state"]) =>
    state === "running"
      ? theme().text.feedback.success.base
      : state === "deleting"
        ? theme().text.feedback.error.base
        : theme().text.feedback.warning.base;

  return (
    <Show when={rows().length > 0}>
      <box flexDirection="column">
        <text fg={theme().text.base}>
          <b>Sandboxes</b>
        </text>
        <For each={rows()}>
          {(row) => (
            <box flexDirection="column">
              <text fg={theme().text.base}>
                <span style={{ fg: dot(row.state) }}>•</span> {truncate(row.title, WIDTH - 2)}
              </text>
              <text fg={theme().text.muted}> {truncate(row.detail, WIDTH - 2)}</text>
            </box>
          )}
        </For>
      </box>
    </Show>
  );
}

export default Plugin.define({
  id: "gitterm.sandbox",
  setup(context) {
    return context.ui.slot({
      append: "sidebar.content",
      render: (input) => <SandboxSidebar sessionID={input.sessionID} />,
    });
  },
});
