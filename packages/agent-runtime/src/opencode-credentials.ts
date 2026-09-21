/**
 * OpenCode stores credentials in SQLite and offers no headless import, so fresh
 * containers receive this JSON plus a local plugin that imports it through the
 * integration API on first load.
 */
export const OPENCODE_CREDENTIALS_PATH = "~/.gitterm/opencode/credentials.json";
export const OPENCODE_CREDENTIALS_PLUGIN_PATH = "~/.config/opencode/plugins/gitterm-credentials.js";
/** Label on imported credentials; the plugin uses it to stay idempotent across restarts. */
export const OPENCODE_CREDENTIAL_LABEL = "Gitterm";

export type OpencodeAuthEntry =
  | { type: "api"; key: string; metadata?: Record<string, string> }
  | {
      type: "oauth";
      refresh: string;
      access?: string;
      expires?: number;
      accountId?: string;
      enterpriseUrl?: string;
    };

export interface OpencodeCredentialFile {
  path: string;
  contentBase64: string;
  mode?: 0o600;
}

/** Files that make `auth` available to OpenCode inside the workspace. */
export function opencodeCredentialFiles(
  auth: Record<string, OpencodeAuthEntry>,
): OpencodeCredentialFile[] {
  return [
    {
      path: OPENCODE_CREDENTIALS_PATH,
      contentBase64: Buffer.from(JSON.stringify(auth)).toString("base64"),
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

const LABEL = ${JSON.stringify(OPENCODE_CREDENTIAL_LABEL)};
const METHOD_ID = "gitterm-import";
const FILE = path.join(process.env.HOME || os.homedir(), ".gitterm/opencode/credentials.json");
const DEVICE_FLOW = ["github-copilot", "opencode", "xai"];
const log = (message, detail) => console.log("[gitterm-credentials] " + message + (detail ? ": " + detail : ""));

function readCredentials() {
  try {
    return Object.entries(JSON.parse(readFileSync(FILE, "utf8")))
      .map(([id, value]) => [id.replace(/\/+$/, ""), value])
      .filter(([id, value]) => id && value && (value.type === "api" || value.type === "oauth"));
  } catch (error) {
    if (error?.code !== "ENOENT") log("unreadable credentials file", String(error));
    return [];
  }
}

function builtinOAuthMethod(id, methods) {
  const preferred = id === "openai" ? "chatgpt-browser" : DEVICE_FLOW.includes(id) ? "device" : "oauth";
  const oauth = methods.filter((method) => method.type === "oauth" && method.id !== METHOD_ID);
  return (oauth.find((method) => method.id === preferred) ?? oauth[0])?.id;
}

function toOAuthCredential(methodID, value) {
  const metadata = {
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

async function importOAuth(ctx, id) {
  const attempt = (await ctx.integration.oauth.connect({ integrationID: id, methodID: METHOD_ID, label: LABEL })).data;
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
    const entries = readCredentials();
    const oauth = entries.filter(([, value]) => value.type === "oauth");
    if (oauth.length) {
      await ctx.integration.transform((editor) => {
        for (const [id, value] of oauth) {
          if (!editor.get(id)) continue;
          const methodID = builtinOAuthMethod(id, editor.method.list(id));
          if (!methodID) continue;
          editor.method.update({
            integrationID: id,
            method: { id: METHOD_ID, type: "oauth", label: LABEL },
            authorize: async () => ({
              url: "",
              instructions: "Importing the credential provided by Gitterm",
              mode: "auto",
              callback: Promise.resolve(toOAuthCredential(methodID, value)),
            }),
          });
        }
      });
    }
    for (const [id, value] of entries) {
      const info = await ctx.integration.get({ integrationID: id }).then((result) => result.data, () => undefined);
      if (!info) {
        log("unknown integration, skipping", id);
        continue;
      }
      if (info.connections.some((connection) => connection.type === "credential" && connection.label === LABEL)) continue;
      if (value.type === "api") {
        await ctx.integration.connect.key({ integrationID: id, key: value.key, label: LABEL });
        log("imported API key", id);
        continue;
      }
      if (!info.methods.some((method) => method.type === "oauth" && method.id === METHOD_ID)) {
        log("no OAuth method available, skipping", id);
        continue;
      }
      const result = await importOAuth(ctx, id);
      if (result.status === "complete") log("imported OAuth credential", id);
      else log("OAuth import " + result.status, id + (result.message ? " (" + result.message + ")" : ""));
    }
  },
};
`;
