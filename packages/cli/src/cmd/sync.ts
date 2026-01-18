import * as Bun from "bun";
import { homedir } from "node:os";
import { subtle } from "node:crypto";
import { join } from "node:path";
import type { Session, Message, Part } from "@opencode-ai/sdk";
import { loadConfig, loginViaDeviceCode, saveConfig } from "./auth.js";
import { localOpencodeDb } from "../db/index.js";
import { LocalMessageTable as MessageTable, LocalPartTable as PartTable, LocalPermissionTable as PermissionTable, LocalSessionTable as SessionTable, LocalTodoTable as TodoTable } from "@gitterm/sync-sqlite/schema/local/session";
import { SessionShareTable as SessionShareTable, ShareTable as ShareTable } from "@gitterm/sync-sqlite/schema/share";
import { eq, desc } from "drizzle-orm";
// ===== TYPES =====
type ReturnedSessionList = {
    id: string;
    title: string;
    created: number;
    updated: number;
    projectId: string;
    directory: string;
}
type SessionExport = {
    info: Session;
    messages: {
        info: Message,
        parts: Part[]
    }[]
}
type Manifest = {
    projectId: string
    snapshot: string
    createdAt: number
    parentSnapshot?: string
    files: {
        [path: string]: {
            size: number
            chunks: string[]
            mode?: number
        }
    }
}

// ===== CONFIGURATION =====
type SyncConfig = {
    chunkSize: number;
  };
  
const CONFIG: SyncConfig = {
    chunkSize: 256 * 1024, // 256KB
};

// ===== CHUNKING =====
async function sha256(data: Uint8Array): Promise<string> {
    const hash = await subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
}
  
async function* chunkFile(path: string) {
    const file = Bun.file(path);
    const reader = file.stream().getReader();
  
    let buffer = new Uint8Array(CONFIG.chunkSize);
    let offset = 0;
    let index = 0;
  
    while (true) {
      const { value, done } = await reader.read();
      if (done && offset === 0) break;
  
      if (value) {
        buffer.set(value, offset);
        offset += value.length;
      }
  
      if (offset >= CONFIG.chunkSize || (done && offset > 0)) {
        const chunk = buffer.slice(0, offset);
        yield {
          index,
          hash: await sha256(chunk),
          data: chunk,
        };
        buffer = new Uint8Array(CONFIG.chunkSize);
        offset = 0;
        index++;
      }
  
      if (done) break;
    }
}

async function buildManifest(
    projectId: string,
    snapshotDir: string,
    snapshot: string,
    parent?: string
  ): Promise<Manifest> {
    const files = await filesInSnapshot(snapshotDir, snapshot);
    const cwd = process.cwd();
  
    const manifest: Manifest = {
      projectId: projectId,
      snapshot,
      parentSnapshot: parent,
      createdAt: Date.now(),
      files: {},
    };
  
    for (const file of files) {
      const full = join(cwd, file);
      const size = Bun.file(full).size;
      const chunks: string[] = [];
  
      for await (const chunk of chunkFile(full)) {
        chunks.push(chunk.hash);
      }
  
      manifest.files[file] = { size, chunks };
    }
  
    return manifest;
  }

async function loadBaseline(cliToken: string, SERVER_URL: string, projectId: string): Promise<string | null> {
  try {
    const response = await fetch(new URL(`/trpc/sync.getSyncedProjectCurrentSnapshot`, SERVER_URL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${cliToken}`,
      },
      body: JSON.stringify({
        projectId: projectId,
      }),  
    });
    const data = await response.json() as { success: boolean, currentSnapshot: string | null };
    if (!data.success) {
      throw new Error("Failed to get current snapshot");
    }
    return data.currentSnapshot;
  } catch (error) {
    throw new Error("Failed to get current snapshot", { cause: error });
  }
}

async function trackSnapshot(): Promise<string> {
    return (await Bun.$`opencode debug snapshot track`.text()).trim();
}
  
async function patchSnapshot(hash: string) {
    return (await Bun.$`opencode debug snapshot patch ${hash}`.json()) as {
      hash: string;
      files: string[];
    };
}
  
async function filesInSnapshot(snapshotDir: string, hash: string): Promise<string[]> {
    const out = await Bun.$`git --git-dir ${snapshotDir} ls-tree -r --name-only ${hash}`
      .quiet()
      .nothrow()
      .text();
  
    return out.trim().split("\n").filter(Boolean);
}

async function getSessions(projectId: string) {
  const sessions = await localOpencodeDb.select().from(SessionTable)
  .where(eq(SessionTable.projectID, projectId))
  .orderBy(desc(SessionTable.time_updated))
  .limit(15);
  return sessions;
}

async function getMessages(sessionId: string) {
  const messages = await localOpencodeDb.select().from(MessageTable)
  .where(eq(MessageTable.sessionID, sessionId))
  .orderBy(desc(MessageTable.createdAt));
  return messages;
}

async function getParts(sessionId: string) {
  const parts = await localOpencodeDb.select().from(PartTable)
  .where(eq(PartTable.sessionID, sessionId))
  return parts;
}

async function getTodos(sessionId: string) {
  const todos = await localOpencodeDb.select().from(TodoTable)
  .where(eq(TodoTable.sessionID, sessionId))
  return todos;
}

async function getPermission(projectId: string) {
  const permission = await localOpencodeDb.select().from(PermissionTable)
  .where(eq(PermissionTable.projectID, projectId))
  return permission;
}
  
async function getSessionShare(sessionId: string) {
  const sessionShare = await localOpencodeDb.select().from(SessionShareTable)
  .where(eq(SessionShareTable.sessionID, sessionId))
  return sessionShare;
}

async function getShare(sessionId: string) {
  const share = await localOpencodeDb.select().from(ShareTable)
  .where(eq(ShareTable.sessionID, sessionId))
  return share;
}

// ===== MAIN SYNC FUNCTION =====
export async function sync(SERVER_URL: string) {

  console.log(`Syncing project to ${SERVER_URL}...`);
  try {
    console.log("Loading config...");
    let config = await loadConfig();
    console.log("Config loaded:", config ? "found" : "not found");
    
    console.log("Parsing URLs...");
    const savedServerUrl = config?.serverUrl ? new URL(config.serverUrl).origin : null;
    const targetServerUrl = new URL(SERVER_URL).origin;
    const isDifferentServer = savedServerUrl && savedServerUrl !== targetServerUrl;
    console.log("URLs parsed, isDifferentServer:", isDifferentServer);


    if (!config?.cliToken || isDifferentServer) {
      if (isDifferentServer) {
        console.log(`Switching to ${targetServerUrl}. Starting login...`);
      } else {
        console.log("No saved credentials found. Starting login...");
      }
      const { cliToken } = await loginViaDeviceCode(SERVER_URL);
      config = { serverUrl: SERVER_URL, cliToken, createdAt: Date.now() };
      await saveConfig(config);
      console.log("Logged in successfully!\n");
    }

    const cliToken = config?.cliToken;
    if (!cliToken) {
      throw new Error("No CLI token available");
    }
    console.log("CLI token available, fetching sessions...");

    const projects = await Bun.$`opencode debug scrap`.json() as { id: string, worktree: string }[];

    const currentDir = process.cwd();

    const currentProject = projects.find(project => project.worktree === currentDir);

    if (!currentProject) {
      throw new Error("No project found in current directory");
    }

    const projectId = currentProject.id;

    const sessions = await getSessions(projectId);
    
    if (sessions.length === 0) {
      throw new Error("No sessions found");
    }

    const permission = await getPermission(projectId);

    let messages = [];
    let parts = [];
    let todos = [];
    let sessionShares = [];
    let shares = [];

    for (const session of sessions) {
      const sessionMessages = await getMessages(session.id);
      const sessionParts = await getParts(session.id);
      const sessionTodos = await getTodos(session.id);
      const sessionSessionShare = await getSessionShare(session.id);
      const sessionShare = await getShare(session.id);
      messages.push(...sessionMessages);
      parts.push(...sessionParts);
      todos.push(...sessionTodos);
      sessionShares.push(...sessionSessionShare);
      shares.push(...sessionShare);
    }


    console.log(`Project ID: ${projectId}`);


    const snapshotDir = join(homedir(), ".local", "opencode", "snapshots", projectId);

    const previous = await loadBaseline(cliToken, SERVER_URL, projectId);
    const current = await trackSnapshot();
  
    if (!current) throw new Error("Failed to create snapshot");
  
    let chunks: { hash: string; data: Uint8Array }[] = [];
    let exportedSessions: {id: string, file: File}[] = [];
    
    let manifest: Manifest;
    if (!previous) {
      // First sync → full snapshot
      manifest = await buildManifest(projectId, snapshotDir, current);
      for (const file of Object.keys(manifest.files)) {
        for await (const chunk of chunkFile(join(process.cwd(), file))) {
          chunks.push({ hash: chunk.hash, data: chunk.data });
        }
      }
    } else {
      const patch = await patchSnapshot(previous);
      manifest = await buildManifest(projectId, snapshotDir, current, previous);
      if (patch.files.length > 0) {
        for (const file of patch.files) {
          for await (const chunk of chunkFile(file)) {
            chunks.push({ hash: chunk.hash, data: chunk.data });
          }
        }
      }
    }

    // const response = await fetch(new URL(`/trpc/sync.syncProject`, SERVER_URL), {
    //   method: "POST",
    //   headers: {
    //     "Content-Type": "application/json",
    //     "Authorization": `Bearer ${cliToken}`,
    //   },
    //   body: JSON.stringify({
    //     projectId: projectId,
    //     manifest: manifest,
    //     chunks: chunks,
    //     sessions: exportedSessions,
    //   }),
    // });

    // const data = await response.json() as { success: boolean, message: string, projectId: string, manifestId: string, chunks: number, sessions: number };

    // if (!data.success) {
    //     return console.error(data.message);
    // }

    console.log(`Project ${projectId} synced successfully`);
    // console.log(`Manifest ID: ${data.manifestId}`);
    // console.log(`Chunks: ${data.chunks}`);
    // console.log(`Sessions: ${data.sessions}`);

    console.log(`Project ID: ${manifest.projectId}`);
    console.log(`Snapshot: ${manifest.snapshot}`);
    console.log(`Parent Snapshot: ${manifest.parentSnapshot}`);
    console.log(`Created At: ${manifest.createdAt}`);
    console.log(`Files: ${Object.keys(manifest.files).length}`);
    console.log(`Chunks: ${chunks.length}`);
    console.log(`Sessions: ${exportedSessions.length}`);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}  