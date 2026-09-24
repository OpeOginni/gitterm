/**
 * OpenCode stores credentials in SQLite and offers no headless import, so fresh
 * containers receive this JSON plus a local plugin that imports it through the
 * integration API on first load.
 */
export const OPENCODE_CREDENTIALS_PATH = "~/.gitterm/opencode/credentials.json";
export const OPENCODE_CREDENTIALS_PLUGIN_PATH = "~/.config/opencode/plugins/gitterm-credentials.js";
/** Label for credentials that have no dashboard label, such as inline API keys. */
export const OPENCODE_CREDENTIAL_LABEL = "Gitterm";

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
// values carry OpenCode's built-in method ID so OpenCode refreshes them itself.
export const OPENCODE_CREDENTIALS_PLUGIN = String.raw`
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const METHOD_ID = "gitterm-import";
const FILE = path.join(process.env.HOME || os.homedir(), ".gitterm/opencode/credentials.json");
const DEVICE_FLOW = ["github-copilot", "opencode", "xai"];
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
        for (const [id] of oauthIntegrations) {
          if (!editor.get(id)) continue;
          const methodID = builtinOAuthMethod(id, editor.method.list(id));
          if (!methodID) continue;
          editor.method.update({
            integrationID: id,
            method: { id: METHOD_ID, type: "oauth", label: "Gitterm" },
            authorize: async () => ({
              url: "",
              instructions: "Importing the credential provided by Gitterm",
              mode: "auto",
              callback: Promise.resolve(toOAuthCredential(methodID, pending.get(id))),
            }),
          });
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
