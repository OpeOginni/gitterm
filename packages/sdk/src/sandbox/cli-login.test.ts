import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { signExeDevToken } from "./cli-login";
import { describeSandboxAccount, resolveSandboxAccount } from "./config";

const saved = { home: process.env.HOME, daytona: process.env.DAYTONA_CONFIG_DIR };
let home: string;
beforeAll(async () => {
  home = await mkdtemp(path.join(tmpdir(), "gitterm-cli-login-"));
  process.env.HOME = home;
  process.env.DAYTONA_CONFIG_DIR = path.join(home, "daytona");
});
afterAll(async () => {
  process.env.HOME = saved.home;
  if (saved.daytona === undefined) delete process.env.DAYTONA_CONFIG_DIR;
  else process.env.DAYTONA_CONFIG_DIR = saved.daytona;
  await rm(home, { recursive: true, force: true });
});

test("without apiKey, E2B and Daytona accounts use the key their CLI saved", async () => {
  // Not logged in: still your own account, with a clear missing credential.
  const before = describeSandboxAccount(await resolveSandboxAccount({ provider: "e2b" }));
  expect(before).toMatchObject({ mode: "direct", credentialPresent: false });

  await mkdir(path.join(home, ".e2b"));
  await writeFile(
    path.join(home, ".e2b", "config.json"),
    JSON.stringify({ tokens: { access_token: "oauth" }, teamApiKey: "e2b_from_cli" }),
  );
  await mkdir(path.join(home, "daytona"));
  await writeFile(
    path.join(home, "daytona", "config.json"),
    JSON.stringify({
      activeProfile: "p2",
      profiles: [
        { id: "p1", name: "old", api: { key: "dtn_other" } },
        { id: "p2", name: "work", api: { key: "dtn_from_cli" } },
      ],
    }),
  );
  const e2b = await resolveSandboxAccount({ provider: "e2b" });
  expect(e2b).toMatchObject({ ownKey: true, config: { apiKey: "e2b_from_cli" } });
  expect(describeSandboxAccount(e2b).credentialSource).toBe("E2B CLI login (~/.e2b/config.json)");
  const daytona = await resolveSandboxAccount({ provider: "daytona" });
  expect(daytona).toMatchObject({ ownKey: true, config: { apiKey: "dtn_from_cli" } });
  expect(describeSandboxAccount(daytona).credentialSource).toBe("Daytona CLI login (profile work)");
  // An explicit key always wins.
  const explicit = await resolveSandboxAccount({ provider: "e2b", apiKey: "e2b_explicit" });
  expect(explicit).toMatchObject({ config: { apiKey: "e2b_explicit" } });
  expect(explicit).not.toHaveProperty("cliLogin");
});

test("a signed exe.dev token carries its permissions and verifies with the SSH key", async () => {
  const key = path.join(home, "id_ed25519");
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "test", "-f", key]);
  const token = await signExeDevToken(key, new Date(2_000_000_000_000));
  const [prefix, payload, signature] = token.split(".");
  expect(prefix).toBe("exe0");
  const permissions = Buffer.from(payload!, "base64url").toString();
  expect(JSON.parse(permissions)).toMatchObject({
    exp: 2_000_000_000,
    cmds: expect.arrayContaining(["new", "ssh", "rm", "ssh-key generate-api-key"]),
  });
  const pem = `-----BEGIN SSH SIGNATURE-----\n${Buffer.from(signature!, "base64url").toString("base64")}\n-----END SSH SIGNATURE-----\n`;
  await writeFile(path.join(home, "sig"), pem);
  const publicKey = (await readFile(`${key}.pub`, "utf8")).trim();
  await writeFile(path.join(home, "allowed"), `test ${publicKey}\n`);
  execFileSync(
    "ssh-keygen",
    [
      "-Y",
      "verify",
      "-f",
      path.join(home, "allowed"),
      "-I",
      "test",
      "-n",
      "v0@exe.dev",
      "-s",
      path.join(home, "sig"),
    ],
    { input: permissions, stdio: ["pipe", "pipe", "pipe"] },
  );
});
