/** Opt-in upstream CLI compatibility check. No model requests or provider accounts. */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { T3_PAIRING_CREATE_COMMAND } from "../packages/api/src/service/agents/t3code";
import { buildT3OriginBridgeSource } from "../packages/api/src/service/agents/t3-origin-bridge";

const binary = process.env.T3_SMOKE_BINARY;
if (!binary) throw new Error("Set T3_SMOKE_BINARY to a locally installed t3 executable");
if (process.platform === "win32")
  throw new Error("This process-group smoke check requires Linux or macOS");
const executable = resolve(binary);
const root = mkdtempSync(join(process.env.T3_SMOKE_ROOT ?? tmpdir(), "gitterm-t3-smoke-"));
const repo = join(root, "repo");
mkdirSync(repo);
const env = {
  // Do not inherit real model keys, config overrides, or workspace credentials.
  TMPDIR: process.env.TMPDIR ?? tmpdir(),
  LANG: process.env.LANG ?? "en_US.UTF-8",
  HOME: root,
  T3CODE_HOME: join(root, ".t3code"),
  XDG_CONFIG_HOME: join(root, ".config"),
  XDG_DATA_HOME: join(root, ".local/share"),
  XDG_STATE_HOME: join(root, ".local/state"),
  XDG_CACHE_HOME: join(root, ".cache"),
  PATH: `${dirname(executable)}:${process.env.PATH}`,
};
const reservation = Bun.serve({ port: 0, fetch: () => new Response() });
const port = reservation.port!;
reservation.stop(true);
const url = `http://127.0.0.1:${port}`;
const bridge = join(root, "t3-origin-bridge.cjs");
writeFileSync(bridge, buildT3OriginBridgeSource(`127.0.0.1:${port}`));
let server: ChildProcess | undefined;
let projectPath = "/api/orchestration/snapshot";

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function start() {
  server = spawn(
    "node",
    [
      bridge,
      executable,
      "start",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--no-browser",
      "--auto-bootstrap-project-from-cwd",
    ],
    { cwd: repo, env, stdio: "ignore", detached: true },
  );
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${url}/.well-known/t3/environment`, {
      signal: AbortSignal.timeout(2_000),
    }).catch(() => null);
    if (response?.ok) {
      const descriptor = (await response.json()) as { orchestrationProtocolVersion?: number };
      projectPath =
        descriptor.orchestrationProtocolVersion === 2
          ? "/api/projects"
          : "/api/orchestration/snapshot";
      return;
    }
    if (server.exitCode !== null) throw new Error("T3 exited before readiness");
    await Bun.sleep(250);
  }
  throw new Error("T3 readiness timed out");
}

async function stop() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const exited = once(server, "exit");
  // The bridge owns T3's process group and forwards termination to the native
  // executable as well as npm's launcher. SIGKILL would skip that cleanup.
  server.kill("SIGTERM");
  await Promise.race([
    exited,
    Bun.sleep(8_000).then(() => {
      throw new Error("T3 shutdown timed out");
    }),
  ]);
}

async function mint() {
  const process = Bun.spawn(["sh", "-c", T3_PAIRING_CREATE_COMMAND], {
    cwd: repo,
    env,
    stdout: "pipe",
    stderr: "ignore",
  });
  const token = (await new Response(process.stdout).text()).trim();
  check((await process.exited) === 0 && token, "Pairing command did not produce a credential");
  return token;
}

async function pair(token: string) {
  return fetch(`${url}/api/auth/browser-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://app.t3.codes" },
    body: JSON.stringify({ credential: token }),
    signal: AbortSignal.timeout(10_000),
  });
}

async function verifyProject(cookie: string) {
  const response = await fetch(`${url}${projectPath}`, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(10_000),
  });
  check(response.ok, "Authenticated snapshot failed");
  const snapshot = (await response.json()) as { projects: Array<{ workspaceRoot: string }> };
  check(
    snapshot.projects.filter((project) => project.workspaceRoot === repo).length === 1,
    "Startup did not register exactly one project",
  );
}

async function verifySignedPairing(token: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  function proof(method: string, path: string, accessToken?: string) {
    const data = `${encode({ typ: "dpop+jwt", alg: "ES256", jwk: publicKey.export({ format: "jwk" }) })}.${encode(
      {
        htm: method,
        htu: `${url}${path}`,
        iat: Math.floor(Date.now() / 1000),
        jti: randomUUID(),
        ...(accessToken
          ? { ath: createHash("sha256").update(accessToken).digest("base64url") }
          : {}),
      },
    )}`;
    return `${data}.${sign("sha256", Buffer.from(data), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  }
  const response = await fetch(`${url}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Host: "provider-ingress.example",
      DPoP: proof("POST", "/oauth/token"),
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: token,
      subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  check(response.ok, `Signed pairing behind provider ingress failed (${response.status})`);
  const result = (await response.json()) as { access_token: string; token_type: string };
  check(result.token_type === "DPoP", "Pairing did not issue a proof-bound session");
  const snapshot = await fetch(`${url}${projectPath}`, {
    headers: {
      Host: "provider-ingress.example",
      Authorization: `DPoP ${result.access_token}`,
      DPoP: proof("GET", projectPath, result.access_token),
    },
    signal: AbortSignal.timeout(10_000),
  });
  check(
    snapshot.ok,
    `Signed authenticated request behind provider ingress failed (${snapshot.status})`,
  );
  // Origin restoration must not turn into disabling proof verification.
  const invalid = await fetch(`${url}${projectPath}`, {
    headers: {
      Authorization: `DPoP ${result.access_token}`,
      DPoP: proof("GET", "/wrong-path", result.access_token),
    },
    signal: AbortSignal.timeout(10_000),
  });
  check(invalid.status === 401, "T3 accepted a proof signed for a different URL");
}

try {
  await start();
  console.log("T3 smoke: server ready");
  const unauthenticated = await fetch(`${url}${projectPath}`, {
    signal: AbortSignal.timeout(10_000),
  });
  check(unauthenticated.status === 401, "Origin bridge allowed an unauthenticated project request");
  const token = await mint();
  console.log("T3 smoke: credential issued");
  const response = await pair(token);
  check(response.ok, "Hosted-app pairing failed");
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  check(cookie, "Pairing did not issue a browser session");
  check(!(await pair(token)).ok, "A one-time pairing token was reusable");
  await verifyProject(cookie);
  await verifySignedPairing(await mint());
  console.log("T3 smoke: pairing and project verified");
  const nextToken = await mint();
  check(nextToken !== token, "Fresh pairing token was not unique");
  await stop();
  const stopped = await fetch(`${url}/.well-known/t3/environment`, {
    signal: AbortSignal.timeout(2_000),
  }).catch(() => null);
  check(!stopped, "Native T3 server survived shutdown; restart was not isolated");
  await start();
  await verifyProject(cookie);
  check((await pair(nextToken)).ok, "Unused pairing grant did not survive restart");
  console.log(
    "T3 smoke passed: discovery, hosted-app pairing, DPoP behind provider ingress, one-time tokens, project registration, restart persistence",
  );
} finally {
  await stop();
  rmSync(root, { recursive: true, force: true });
}
