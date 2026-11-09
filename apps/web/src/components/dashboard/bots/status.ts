import { formatDistanceToNow } from "date-fns";
import type { Tone } from "../kit";

export type BotToken = {
  prefix: string;
  lastUsedAt: Date | string | null;
  expiresAt: Date | string | null;
  revoked: boolean;
} | null;

/** A running bot renews its claim every few seconds; a claim lasts 90 s. */
const RUNNING_WINDOW = 5 * 60_000;
const EXPIRY_WARNING = 30 * 24 * 60 * 60_000;

const ago = (value: Date | string) => formatDistanceToNow(new Date(value), { addSuffix: true });

export const formatDay = (value: Date | string) =>
  new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/** Whether the bot is running, from when its token last reached GitTerm. */
export function botStatus(token: BotToken): {
  tone: Tone;
  label: string;
  detail: string;
  pulse?: boolean;
} {
  if (!token || token.revoked) return { tone: "danger", label: "No token", detail: "Create one" };
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) {
    return { tone: "danger", label: "Token expired", detail: "Create a new one" };
  }
  if (!token.lastUsedAt) return { tone: "muted", label: "Not started", detail: "Never seen" };
  if (Date.now() - new Date(token.lastUsedAt).getTime() < RUNNING_WINDOW) {
    return { tone: "ok", label: "Running", detail: `Seen ${ago(token.lastUsedAt)}`, pulse: true };
  }
  return { tone: "muted", label: "Stopped", detail: `Seen ${ago(token.lastUsedAt)}` };
}

/** The token's expiry, warning a month ahead: an expired token stops the bot. */
export function tokenExpiry(token: BotToken): { text: string; tone: "muted" | "soon" | "gone" } {
  if (!token) return { text: "No token", tone: "gone" };
  if (token.revoked) return { text: "Revoked", tone: "gone" };
  if (!token.expiresAt) return { text: "No expiry", tone: "muted" };
  const left = new Date(token.expiresAt).getTime() - Date.now();
  if (left <= 0) return { text: `Expired ${formatDay(token.expiresAt)}`, tone: "gone" };
  if (left < EXPIRY_WARNING) {
    return {
      text: `Expires ${formatDistanceToNow(new Date(token.expiresAt), { addSuffix: true })}`,
      tone: "soon",
    };
  }
  return { text: `Expires ${formatDay(token.expiresAt)}`, tone: "muted" };
}

export const EXPIRY_TEXT = { muted: "text-fg-4", soon: "text-primary", gone: "text-destructive" };

/** `owner/repo` and the branch, from a saved repository URL. */
export function repoParts(repo: string): { name: string; branch: string | null } {
  const [url = "", branch] = repo.split("#");
  return {
    name: url.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, ""),
    branch: branch || null,
  };
}

export const platformName = (platform: string) => (platform === "slack" ? "Slack" : "Discord");

/** Where it answers, in a few words. */
export const answersIn = (channels: string[]) =>
  channels.length === 0
    ? "Every channel"
    : channels.length === 1
      ? "1 channel"
      : `${channels.length} channels`;
