import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Credentials a provider's own CLI already saved, used when an account has no `apiKey`.
 * Values stay in memory; nothing is written or created.
 */
export type CliLogin = { value: string; source: string };

export const CLI_LOGIN_PROVIDERS = ["e2b", "daytona", "exedev"] as const;

const home = () => process.env.HOME || homedir();

function readJson(file: string): any {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** `e2b auth login` saves the team's API key next to its OAuth tokens. */
function e2b(): CliLogin | undefined {
  const key = readJson(path.join(home(), ".e2b", "config.json"))?.teamApiKey;
  return typeof key === "string" && key
    ? { value: key, source: "E2B CLI login (~/.e2b/config.json)" }
    : undefined;
}

/** `daytona login --api-key` saves the key in the active profile. Browser logins have none. */
function daytona(): CliLogin | undefined {
  const configDir =
    process.platform === "darwin"
      ? path.join(home(), "Library", "Application Support")
      : process.platform === "win32"
        ? (process.env.APPDATA ?? "")
        : process.env.XDG_CONFIG_HOME || path.join(home(), ".config");
  const config = readJson(
    path.join(process.env.DAYTONA_CONFIG_DIR || path.join(configDir, "daytona"), "config.json"),
  );
  const profile = config?.profiles?.find(
    (item: { id?: string }) => item.id === config.activeProfile,
  );
  const key = profile?.api?.key;
  return typeof key === "string" && key
    ? { value: key, source: `Daytona CLI login (profile ${profile.name ?? profile.id})` }
    : undefined;
}

const run = (command: string, args: string[], input = "") =>
  new Promise<string>((resolve) => {
    // Detached: no terminal, so a passphrase-protected key fails instead of prompting.
    const child = spawn(command, args, {
      detached: true,
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 10_000,
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.on("error", () => resolve(""));
    child.on("close", (code) => resolve(code === 0 ? output : ""));
    child.stdin.end(input);
  });

/** What a sandbox token may do: the sandbox commands and preview key management. */
const EXEDEV_CMDS = [
  "whoami",
  "new",
  "ls",
  "ssh",
  "pause",
  "resume",
  "rm",
  "ssh-key generate-api-key",
  "ssh-key list",
  "ssh-key remove",
];

/** An exe.dev API token signed with an SSH key, as exe.dev documents for local token creation. */
export async function signExeDevToken(keyFile: string, expiresAt: Date): Promise<string> {
  const permissions = JSON.stringify({
    exp: Math.floor(expiresAt.getTime() / 1000),
    cmds: EXEDEV_CMDS,
  });
  const signature = await run(
    "ssh-keygen",
    ["-Y", "sign", "-f", keyFile, "-n", "v0@exe.dev"],
    permissions,
  );
  const body = signature.split("\n").filter((line) => line && !line.startsWith("-----"));
  if (!body.length) return "";
  const sig = Buffer.from(body.join(""), "base64").toString("base64url");
  return `exe0.${Buffer.from(permissions).toString("base64url")}.${sig}`;
}

/**
 * exe.dev's CLI is `ssh exe.dev`: sign a 30-day token with the SSH key that command uses.
 * Nothing is created on the account, so there is nothing to clean up.
 */
async function exedev(): Promise<CliLogin | undefined> {
  const keys = (await run("ssh", ["-G", "exe.dev"]))
    .split("\n")
    .filter((line) => line.startsWith("identityfile "))
    .map((line) => line.slice("identityfile ".length).replace(/^~(?=\/)/, home()))
    // The public key signs through ssh-agent; the private key works when it has no passphrase.
    .flatMap((file) => [`${file}.pub`, file])
    .filter((file) => existsSync(file));
  for (const key of keys) {
    const token = await signExeDevToken(key, new Date(Date.now() + 30 * 24 * 60 * 60_000));
    if (!token) continue;
    const response = await fetch("https://exe.dev/exec", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: "whoami",
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
    if (response?.ok)
      return { value: token, source: `exe.dev CLI login (SSH key ${key.replace(/\.pub$/, "")})` };
  }
}

export async function cliLogin(provider: string): Promise<CliLogin | undefined> {
  if (provider === "e2b") return e2b();
  if (provider === "daytona") return daytona();
  if (provider === "exedev") return exedev();
}
