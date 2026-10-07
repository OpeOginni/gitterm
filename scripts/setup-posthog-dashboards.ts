import { dashboardDefinitions } from "./posthog-dashboard-definitions";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Uses the authenticated CLI. Every mutation is schema-validated first.
async function call(
  tool: string,
  input: object,
  options: { dryRun?: boolean; confirm?: boolean } = {},
) {
  const process = Bun.spawn(
    [
      "posthog-cli",
      "api",
      "call",
      "--json",
      ...(options.dryRun ? ["--dry-run"] : []),
      ...(options.confirm ? ["--confirm"] : []),
      tool,
      JSON.stringify(input),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [output, error, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${tool}: ${error || output}`);
  const result = JSON.parse(output);
  if (result.isError || result.error) throw new Error(`${tool}: ${JSON.stringify(result)}`);
  return result;
}

if (import.meta.main) {
  const apply = process.argv.includes("--apply");
  if (apply && !process.argv.includes("--set-default")) {
    throw new Error(
      "Obtain approval to replace the project default, then pass --set-default with --apply.",
    );
  }
  const project = await call("project-get", {});
  if (project.id !== 186242 || project.name !== "Gitterm")
    throw new Error("Refusing to modify a different PostHog project.");
  // Snapshot the two inspected old boards before any changes. No credentials are written.
  const snapshots = await Promise.all([702034, 702060].map((id) => call("dashboard-get", { id })));
  const backup = join(
    process.env.POSTHOG_BACKUP_DIRECTORY ?? tmpdir(),
    `gitterm-posthog-dashboard-backup-${Date.now()}.json`,
  );
  await Bun.write(backup, JSON.stringify(snapshots, null, 2));
  console.log(`Old dashboards backed up to ${backup}`);
  const existing = await call("dashboards-get-all", { limit: 100 });
  if (
    existing.results.some((dashboard: { name: string }) =>
      dashboardDefinitions.some((definition) => definition.name === dashboard.name),
    )
  ) {
    throw new Error(
      "A replacement dashboard already exists. Inspect it before rerunning to avoid duplicates.",
    );
  }
  let primaryDashboard: number | undefined;
  for (const { insights, note, ...definition } of dashboardDefinitions) {
    await call("dashboard-create", definition, { dryRun: true });
    for (const insight of insights) await call("insight-create", insight, { dryRun: true });
    if (!apply) continue;
    const board = await call("dashboard-create", definition);
    primaryDashboard ??= board.id;
    for (const insight of insights) {
      const input = { ...insight, dashboards: [board.id] };
      await call("insight-create", input, { dryRun: true });
      await call("insight-create", input);
    }
    const noteInput = {
      id: board.id,
      type: "text",
      body: note,
      layouts: { sm: { x: 0, y: 0, w: 12, h: 3 } },
    };
    await call("dashboard-create-tile", noteInput, { dryRun: true });
    await call("dashboard-create-tile", noteInput);
    const full = await call("dashboard-get", { id: board.id });
    const insightTiles = full.tiles.filter((tile: { insight?: unknown }) => tile.insight);
    if (insightTiles.length !== insights.length)
      throw new Error(`Incomplete dashboard ${definition.name}; old boards were not deleted.`);
    const layouts = insightTiles.map((tile: { id: number }, index: number) => ({
      id: tile.id,
      layouts: {
        sm: { x: (index % 2) * 6, y: 3 + Math.floor(index / 2) * 6, w: index === 4 ? 12 : 6, h: 6 },
      },
    }));
    const update = { id: board.id, tiles: layouts };
    await call("dashboard-update", update, { dryRun: true });
    await call("dashboard-update", update);
    console.log(
      JSON.stringify({
        name: definition.name,
        id: board.id,
        url: full["_posthogUrl"],
        insightCount: insightTiles.length,
      }),
    );
  }
  if (apply && process.argv.includes("--set-default") && primaryDashboard) {
    const settings = { id: project.id, primary_dashboard: primaryDashboard };
    await call("project-settings-update", settings, { dryRun: true });
    await call("project-settings-update", settings, { confirm: true });
  }
  // Soft deletion only, after all replacements have been verified. Existing insights/events remain.
  for (const id of [702034, 702060]) {
    await call("dashboard-delete", { id }, { dryRun: true });
    if (apply) await call("dashboard-delete", { id }, { confirm: true });
  }
  console.log(
    apply
      ? "Created 3 boards / 15 insights and soft-deleted 2 obsolete boards."
      : "Dry run passed. After approval, use --apply --set-default to create replacements and soft-delete the two inspected boards.",
  );
}
