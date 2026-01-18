import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type CliConfig = {
  serverUrl: string;
  cliToken: string;
  createdAt: number;
};

export function getConfigPath(): string {
  return join(homedir(), ".config", "gitterm", "cli.json");
}

async function ensureConfigDir() {
  const configPath = getConfigPath();
  await mkdir(dirname(configPath), { recursive: true });
}

export async function loadConfig(): Promise<CliConfig | null> {
  const path = getConfigPath();
  try {
    const text = await readFile(path, "utf-8");
    const parsed = JSON.parse(text) as CliConfig;
    if (!parsed.cliToken || !parsed.serverUrl) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveConfig(config: CliConfig) {
  await ensureConfigDir();
  await writeFile(getConfigPath(), JSON.stringify(config, null, 2), "utf-8");
}

export async function deleteConfig() {
  const path = getConfigPath();
  try {
    await unlink(path);
  } catch {
    // ignore if file doesn't exist
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type DeviceCodeResponse = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
  expiresInSeconds: number;
};

export async function loginViaDeviceCode(serverUrl: string): Promise<{ cliToken: string }> {
  const codeRes = await fetch(new URL("/api/device/code", serverUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientName: "gitterm" }),
  });
  if (!codeRes.ok) throw new Error(`Failed to start device login: ${codeRes.status}`);

  const codeJson = (await codeRes.json()) as DeviceCodeResponse;

  console.log("To sign in, visit:");
  console.log(`  ${codeJson.verificationUri}`);
  console.log("And enter code:");
  console.log(`  ${codeJson.userCode}`);

  const deadline = Date.now() + codeJson.expiresInSeconds * 1000;
  while (Date.now() < deadline) {
    const tokenRes = await fetch(new URL("/api/device/token", serverUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceCode: codeJson.deviceCode }),
    });

    if (tokenRes.ok) {
      const tokenJson = (await tokenRes.json()) as { accessToken: string };
      return { cliToken: tokenJson.accessToken };
    }

    // 428 = authorization_pending
    if (tokenRes.status !== 428) {
      const errText = await tokenRes.text().catch(() => "");
      throw new Error(`Login failed: ${tokenRes.status} ${errText}`);
    }

    await sleep(Math.max(1, codeJson.intervalSeconds) * 1000);
  }

  throw new Error("Device code expired; try again.");
}
