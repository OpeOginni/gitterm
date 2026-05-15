import { and, db, eq, isNull } from "@gitterm/db";
import { workspaceRouteAccess } from "@gitterm/db/schema/workspace-route-access";
import { getEncryptionService } from "./encryption";
import { invalidateAllProxyRouteAccessCache, invalidateProxyRouteAccessCache } from "./proxy-cache";

const encryption = getEncryptionService();

type UpstreamHeaders = Record<string, string>;

function getRouteAccessCondition(workspaceId: string, port: number | null) {
  return port === null
    ? and(eq(workspaceRouteAccess.workspaceId, workspaceId), isNull(workspaceRouteAccess.port))
    : and(eq(workspaceRouteAccess.workspaceId, workspaceId), eq(workspaceRouteAccess.port, port));
}

function normalizeHeaders(headers: UpstreamHeaders): UpstreamHeaders {
  return Object.fromEntries(
    Object.entries(headers).filter((entry): entry is [string, string] => {
      const [key, value] = entry;
      return Boolean(key) && typeof value === "string" && value.length > 0;
    }),
  );
}

export async function upsertWorkspaceRouteAccess(
  workspaceId: string,
  port: number | null,
  headers: UpstreamHeaders,
): Promise<void> {
  const invalidateRouteAccess = () =>
    port === null
      ? invalidateAllProxyRouteAccessCache(workspaceId)
      : invalidateProxyRouteAccessCache(workspaceId, port);
  const normalizedHeaders = normalizeHeaders(headers);

  if (Object.keys(normalizedHeaders).length === 0) {
    await deleteWorkspaceRouteAccess(workspaceId, port);
    return;
  }

  const encryptedHeaders = encryption.encrypt(JSON.stringify(normalizedHeaders));
  const now = new Date();

  const [existing] = await db
    .select({ id: workspaceRouteAccess.id })
    .from(workspaceRouteAccess)
    .where(getRouteAccessCondition(workspaceId, port))
    .limit(1);

  if (existing) {
    await db
      .update(workspaceRouteAccess)
      .set({ encryptedHeaders, updatedAt: now })
      .where(eq(workspaceRouteAccess.id, existing.id));
    await invalidateRouteAccess();
    return;
  }

  await db.insert(workspaceRouteAccess).values({
    workspaceId,
    port,
    encryptedHeaders,
    createdAt: now,
    updatedAt: now,
  });
  await invalidateRouteAccess();
}

export async function deleteWorkspaceRouteAccess(
  workspaceId: string,
  port: number | null,
): Promise<void> {
  await db.delete(workspaceRouteAccess).where(getRouteAccessCondition(workspaceId, port));
  await (port === null
    ? invalidateAllProxyRouteAccessCache(workspaceId)
    : invalidateProxyRouteAccessCache(workspaceId, port));
}

export async function deleteAllWorkspaceRouteAccess(workspaceId: string): Promise<void> {
  await db.delete(workspaceRouteAccess).where(eq(workspaceRouteAccess.workspaceId, workspaceId));
  await invalidateAllProxyRouteAccessCache(workspaceId);
}

export async function getWorkspaceRouteAccess(
  workspaceId: string,
  port?: number | null,
): Promise<UpstreamHeaders | null> {
  if (port !== undefined && port !== null) {
    const [exactMatch] = await db
      .select({ encryptedHeaders: workspaceRouteAccess.encryptedHeaders })
      .from(workspaceRouteAccess)
      .where(getRouteAccessCondition(workspaceId, port))
      .limit(1);

    if (exactMatch) {
      return JSON.parse(encryption.decrypt(exactMatch.encryptedHeaders)) as UpstreamHeaders;
    }
  }

  const [workspaceLevelAccess] = await db
    .select({ encryptedHeaders: workspaceRouteAccess.encryptedHeaders })
    .from(workspaceRouteAccess)
    .where(getRouteAccessCondition(workspaceId, null))
    .limit(1);

  if (!workspaceLevelAccess) {
    return null;
  }

  return JSON.parse(encryption.decrypt(workspaceLevelAccess.encryptedHeaders)) as UpstreamHeaders;
}
