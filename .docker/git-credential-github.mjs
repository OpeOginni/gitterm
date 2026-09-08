#!/usr/bin/env node

if (process.argv[2] !== "get") process.exit(0);

const tokenFile = "/run/gitterm/github-token";

(async () => {
  const fs = await import("node:fs");
  let expiry = process.env.GITHUB_APP_TOKEN_EXPIRY;
  try {
    expiry = fs.readFileSync(`${tokenFile}.expiry`, "utf8");
  } catch {}

  if (!(Date.parse(expiry) > Date.now() + 300_000)) {
    const response = await fetch(`${process.env.WORKSPACE_API_URL}/workspaceOps.gitCredential`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WORKSPACE_AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("refresh failed");

    const body = await response.json();
    const data = body.result?.data?.json ?? body.result?.data;
    if (!data?.token || !(Date.parse(data.expiresAt) > Date.now())) {
      throw new Error("invalid credential");
    }

    fs.writeFileSync(tokenFile, data.token, { mode: 0o600 });
    fs.writeFileSync(`${tokenFile}.expiry`, data.expiresAt, { mode: 0o600 });
  }

  console.log("protocol=https");
  console.log("host=github.com");
  console.log("username=x-access-token");
  console.log(`password=${fs.readFileSync(tokenFile, "utf8").trim()}`);
})().catch(() => {
  console.error("GitHub credential refresh failed; check the workspace integration.");
  process.exitCode = 1;
});
