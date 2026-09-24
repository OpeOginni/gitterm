import type { Connection, GittermClient } from "../packages/sdk/src/index.ts";

/** Check the SDK integration API and resolve only explicitly selected smoke connections. */
export async function smokeConnections(
  client: GittermClient,
  selection = process.env.GITTERM_E2E_CONNECTION_IDS,
): Promise<Connection[]> {
  const [catalog, available] = await Promise.all([
    client.integrations.catalog(),
    client.integrations.connections.list(),
  ]);
  if (!selection?.trim()) return [];

  const ids = selection.split(",").map((id) => id.trim());
  if (ids.some((id) => !id)) {
    throw new Error("GITTERM_E2E_CONNECTION_IDS must contain nonempty, comma-separated IDs");
  }

  const attached = new Set<string>();
  const selected: Connection[] = [];
  for (const id of ids) {
    const listed = available.find((connection) => connection.id === id);
    if (!listed || !catalog.some((integration) => integration.key === listed.integration)) {
      throw new Error(`Smoke connection ${id} is not available on this deployment`);
    }
    if (listed.status !== "connected") {
      throw new Error(`Smoke connection ${id} is ${listed.status}`);
    }
    if (attached.has(listed.integration)) {
      throw new Error(`Select at most one ${listed.integration} connection for a smoke workspace`);
    }
    const connection = await client.integrations.connections.get(id);
    if (
      connection.id !== id ||
      connection.integration !== listed.integration ||
      connection.status !== "connected"
    ) {
      throw new Error(`Smoke connection ${id} changed while validating it`);
    }
    selected.push(connection);
    attached.add(listed.integration);
  }
  return selected;
}
