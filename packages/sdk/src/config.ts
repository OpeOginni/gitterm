import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_GITTERM_SERVER_URL = "https://api.gitterm.dev";

export type CliConfig = {
  serverUrl: string;
  token: string;
  createdAt: number;
};

export function getConfigPath(configPath?: string): string {
  return configPath ?? join(homedir(), ".config", "gitterm", "cli.json");
}

async function ensureConfigDir(path: string) {
  await mkdir(dirname(path), { recursive: true });
}

function parseConfig(text: string): CliConfig | null {
  const parsed = JSON.parse(text) as Partial<CliConfig>;
  if (!parsed.token || !parsed.serverUrl) return null;
  return {
    serverUrl: parsed.serverUrl,
    token: parsed.token,
    createdAt: parsed.createdAt ?? Date.now(),
  };
}

export async function loadConfig(configPath?: string): Promise<CliConfig | null> {
  try {
    const text = await readFile(getConfigPath(configPath), "utf-8");
    return parseConfig(text);
  } catch {
    return null;
  }
}

export function loadConfigSync(configPath?: string): CliConfig | null {
  try {
    const text = readFileSync(getConfigPath(configPath), "utf-8");
    return parseConfig(text);
  } catch {
    return null;
  }
}

export async function saveConfig(config: CliConfig, configPath?: string) {
  const path = getConfigPath(configPath);
  await ensureConfigDir(path);
  await writeFile(path, JSON.stringify(config, null, 2), "utf-8");
}

export async function deleteConfig(configPath?: string) {
  try {
    await unlink(getConfigPath(configPath));
  } catch {
    // Ignore missing config files so logout is idempotent.
  }
}
