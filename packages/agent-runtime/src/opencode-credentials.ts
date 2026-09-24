/**
 * OpenCode stores credentials in SQLite and offers no headless import, so fresh
 * containers receive this JSON plus a local plugin that imports it through the
 * integration API on first load.
 */
export const OPENCODE_CREDENTIALS_PATH = "~/.gitterm/opencode/credentials.json";
export const OPENCODE_CREDENTIALS_PLUGIN_PATH = "~/.config/opencode/plugins/gitterm-credentials.js";
/** Label for credentials that have no dashboard label, such as inline API keys. */
export const OPENCODE_CREDENTIAL_LABEL = "Gitterm";
/**
 * Stands in for refresh tokens GitTerm keeps. Such credentials carry
 * `metadata.gittermCredentialId`, and the plugin fetches access tokens from GitTerm.
 */
export const OPENCODE_MANAGED_REFRESH = "gitterm-managed";

export type OpencodeAuthEntry =
  | {
      type: "api";
      key: string;
      /** Answers to the integration's key form, such as a Cloudflare `accountId`. */
      metadata?: Record<string, string>;
    }
  | {
      type: "oauth";
      refresh: string;
      access?: string;
      expires?: number;
      accountId?: string;
      enterpriseUrl?: string;
      /** Stored with the credential as-is, e.g. the OpenCode console `server` and `orgID`. */
      metadata?: Record<string, string>;
    };

/** One OpenCode account. An integration may receive several, distinguished by label. */
export interface OpencodeCredentialEntry {
  /** OpenCode provider ID, e.g. `anthropic` or `github-copilot`. */
  integration: string;
  /** Shown in OpenCode; the plugin also keys idempotency on `integration` + `label`. */
  label: string;
  /** The account OpenCode selects for this integration. Defaults to the first entry. */
  active?: boolean;
  value: OpencodeAuthEntry;
}

export interface OpencodeCredentialFile {
  path: string;
  contentBase64: string;
  mode?: 0o600;
}

/** Files that make `entries` available to OpenCode inside the workspace. */
export function opencodeCredentialFiles(
  entries: OpencodeCredentialEntry[],
): OpencodeCredentialFile[] {
  return [
    {
      path: OPENCODE_CREDENTIALS_PATH,
      contentBase64: Buffer.from(JSON.stringify(entries)).toString("base64"),
      mode: 0o600,
    },
    {
      path: OPENCODE_CREDENTIALS_PLUGIN_PATH,
      contentBase64: Buffer.from(OPENCODE_CREDENTIALS_PLUGIN).toString("base64"),
    },
  ];
}

// Plain ESM loaded in-process by OpenCode's Bun runtime from the config plugins
// directory, so it must not import anything beyond node builtins. Stored OAuth
// values carry OpenCode's built-in method ID so OpenCode refreshes them itself,
// except GitTerm-managed ones, whose method refreshes through the GitTerm API.
export const OPENCODE_CREDENTIALS_PLUGIN = String.raw`
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const METHOD_ID = "gitterm-import";
const FILE = path.join(process.env.HOME || os.homedir(), ".gitterm/opencode/credentials.json");
const DEVICE_FLOW = ["github-copilot", "opencode", "xai"];
// OpenCode only enables ChatGPT routing for its own method IDs. The browser method cannot
// complete in a remote workspace (its callback is loopback), so managed accounts take it over.
const MANAGED_METHOD = { openai: "chatgpt-browser" };
const log = (message, detail) => console.log("[gitterm-credentials] " + message + (detail ? ": " + detail : ""));

// Groups entries by integration and orders each group so the active account is created
// last: OpenCode makes the most recently created credential the active one.
function readCredentials() {
  try {
    const entries = JSON.parse(readFileSync(FILE, "utf8"));
    if (!Array.isArray(entries)) return new Map();
    const groups = new Map();
    for (const entry of entries) {
      const integration = typeof entry?.integration === "string" ? entry.integration.replace(/\/+$/, "") : "";
      const value = entry?.value;
      if (!integration || typeof entry.label !== "string" || !entry.label) continue;
      if (!value || (value.type !== "api" && value.type !== "oauth")) continue;
      if (!groups.has(integration)) groups.set(integration, []);
      groups.get(integration).push({ label: entry.label, active: entry.active === true, value });
    }
    for (const group of groups.values()) {
      const active = group.findIndex((entry) => entry.active);
      if (active !== -1 && active !== group.length - 1) group.push(...group.splice(active, 1));
    }
    return groups;
  } catch (error) {
    if (error?.code !== "ENOENT") log("unreadable credentials file", String(error));
    return new Map();
  }
}

function builtinOAuthMethod(id, methods) {
  const preferred = id === "openai" ? "chatgpt-browser" : DEVICE_FLOW.includes(id) ? "device" : "oauth";
  const oauth = methods.filter((method) => method.type === "oauth" && method.id !== METHOD_ID);
  return (oauth.find((method) => method.id === preferred) ?? oauth[0])?.id;
}

// Only answers the key method asks for: OpenCode rejects answers when it shows no form
// (for example because CLOUDFLARE_ACCOUNT_ID is already set).
function keyAnswer(methods, metadata) {
  const form = methods.find((method) => method.type === "key")?.form;
  if (!metadata || !Array.isArray(form)) return undefined;
  const answer = {};
  for (const field of form) {
    if (typeof field?.key === "string" && typeof metadata[field.key] === "string") answer[field.key] = metadata[field.key];
  }
  return Object.keys(answer).length ? answer : undefined;
}

const isManaged = (value) => value?.type === "oauth" && typeof value.metadata?.gittermCredentialId === "string";

// One request per credential at a time; GitTerm serializes across workspaces.
const inflight = new Map();
function managedRefresh(credential) {
  const id = credential.metadata?.gittermCredentialId;
  if (typeof id !== "string") return Promise.resolve(credential);
  if (!inflight.has(id)) {
    inflight.set(id, requestToken(id).then(
      (token) => ({ ...credential, access: token.access, expires: token.expires, metadata: { ...credential.metadata, ...token.metadata } }),
    ).finally(() => inflight.delete(id)));
  }
  return inflight.get(id);
}

async function requestToken(credentialId) {
  const url = process.env.WORKSPACE_API_URL;
  const auth = process.env.WORKSPACE_AGENT_AUTH_TOKEN;
  if (!url || !auth) throw new Error("GitTerm workspace identity is unavailable");
  const response = await fetch(url.replace(/\/$/, "") + "/workspaceOps.modelCredential", {
    method: "POST",
    headers: { Authorization: "Bearer " + auth, "Content-Type": "application/json" },
    body: JSON.stringify({ credentialId }),
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.json().catch(() => undefined);
  const data = body?.result?.data?.json ?? body?.result?.data;
  if (!response.ok || typeof data?.access !== "string" || typeof data?.expires !== "number") {
    const message = body?.error?.json?.message ?? body?.error?.message ?? "status " + response.status;
    log("GitTerm token request failed", message);
    throw new Error("GitTerm could not provide a token: " + message);
  }
  return data;
}

function toOAuthCredential(methodID, value) {
  const metadata = {
    ...(value.metadata && typeof value.metadata === "object" ? value.metadata : {}),
    ...(value.accountId ? { accountID: value.accountId } : {}),
    ...(value.enterpriseUrl ? { enterpriseUrl: value.enterpriseUrl } : {}),
  };
  return {
    type: "oauth",
    methodID,
    refresh: value.refresh,
    access: value.access ?? "",
    expires: value.expires ?? 0,
    ...(Object.keys(metadata).length ? { metadata } : {}),
  };
}

async function importOAuth(ctx, id, label) {
  const attempt = (await ctx.integration.oauth.connect({ integrationID: id, methodID: METHOD_ID, label })).data;
  for (let i = 0; i < 100; i++) {
    const status = (await ctx.integration.oauth.status({ integrationID: id, attemptID: attempt.attemptID })).data;
    if (status.status !== "pending") return status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { status: "failed", message: "timed out" };
}

export default {
  id: "gitterm-credentials",
  async setup(ctx) {
    const groups = readCredentials();
    // One import method per integration; the pending OAuth entry is handed over per attempt.
    const pending = new Map();
    const oauthIntegrations = [...groups].filter(([, entries]) => entries.some((entry) => entry.value.type === "oauth"));
    if (oauthIntegrations.length) {
      await ctx.integration.transform((editor) => {
        for (const [id, entries] of oauthIntegrations) {
          if (!editor.get(id)) continue;
          const builtin = builtinOAuthMethod(id, editor.method.list(id));
          const managed = entries.some((entry) => isManaged(entry.value));
          if (!builtin && !managed) continue;
          const managedMethod = MANAGED_METHOD[id] ?? METHOD_ID;
          const authorize = async () => {
            const value = pending.get(id);
            return {
              url: "",
              instructions: "Importing the credential provided by Gitterm",
              mode: "auto",
              callback: Promise.resolve(toOAuthCredential(isManaged(value) ? managedMethod : builtin, value)),
            };
          };
          editor.method.update({
            integrationID: id,
            method: { id: METHOD_ID, type: "oauth", label: "Gitterm" },
            authorize,
            refresh: managedRefresh,
          });
          if (managed && managedMethod !== METHOD_ID) {
            editor.method.update({
              integrationID: id,
              method: { id: managedMethod, type: "oauth", label: "Managed by Gitterm" },
              authorize,
              refresh: managedRefresh,
            });
          }
        }
      });
    }
    for (const [id, entries] of groups) {
      const info = await ctx.integration.get({ integrationID: id }).then((result) => result.data, () => undefined);
      if (!info) {
        log("unknown integration, skipping", id);
        continue;
      }
      const existing = new Set(
        info.connections.filter((connection) => connection.type === "credential").map((connection) => connection.label),
      );
      const importable = info.methods.some((method) => method.type === "oauth" && method.id === METHOD_ID);
      for (const entry of entries) {
        const target = id + " (" + entry.label + ")";
        if (existing.has(entry.label)) continue;
        try {
          if (entry.value.type === "api") {
            const answer = keyAnswer(info.methods, entry.value.metadata);
            await ctx.integration.connect.key({ integrationID: id, key: entry.value.key, label: entry.label, ...(answer ? { answer } : {}) });
            log("imported API key", target);
            continue;
          }
          if (!importable) {
            log("no OAuth method available, skipping", target);
            continue;
          }
          pending.set(id, entry.value);
          const result = await importOAuth(ctx, id, entry.label);
          if (result.status === "complete") log("imported OAuth credential", target);
          else log("OAuth import " + result.status, target + (result.message ? " (" + result.message + ")" : ""));
        } catch (error) {
          log("import failed", target + " (" + String(error?.message ?? error) + ")");
        }
      }
    }
  },
};
`;
