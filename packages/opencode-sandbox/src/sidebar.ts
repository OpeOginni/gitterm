import type { SandboxRecord } from "@gitterm/sdk/sandbox/store";

export type SidebarRow = {
  id: string;
  title: string;
  detail: string;
  state: SandboxRecord["state"];
};

/** Live sandboxes for one checkout, newest first, as short sidebar lines. */
export function sidebarRows(
  records: SandboxRecord[],
  project: string,
  now = Date.now(),
): SidebarRow[] {
  return records
    .filter(
      (record) =>
        record.project === project &&
        record.state !== "terminated" &&
        !(record.expiresAt && Date.parse(record.expiresAt) <= now),
    )
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((record) => {
      const running = Object.values(record.jobs).filter((job) => job.status === "running").length;
      // Status first: when the line is cut to the sidebar width, only the description shortens.
      const detail = [
        record.state === "running" ? "" : record.state,
        running ? `${running} running` : "",
        ...Object.values(record.previews).map((preview) => `:${preview.port}`),
        record.purpose || record.provider,
      ]
        .filter(Boolean)
        .join(" · ");
      return { id: record.id, title: record.name, detail, state: record.state };
    });
}

export function truncate(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}
