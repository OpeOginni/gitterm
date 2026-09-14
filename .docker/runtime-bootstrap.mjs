#!/usr/bin/env node

const apiUrl = process.env.WORKSPACE_API_URL?.replace(/\/$/, "");
const token = process.env.WORKSPACE_AGENT_AUTH_TOKEN;
if (!apiUrl || !token) throw new Error("Workspace bootstrap identity is unavailable");

const response = await fetch(`${apiUrl}/workspaceOps.runtimeBundle`, {
  headers: { Authorization: `Bearer ${token}` },
  redirect: "error",
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) throw new Error(`Workspace bootstrap failed (${response.status})`);
const body = await response.json();
const data = body.result?.data?.json ?? body.result?.data;
const environment = data?.environment;
if (!environment || typeof environment !== "object" || Array.isArray(environment)) {
  throw new Error("Workspace bootstrap returned an invalid environment");
}

const shellQuote = (value) => `'${value.replaceAll("'", `'"'"'`)}'`;
for (const [key, value] of Object.entries(environment)) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== "string") {
    throw new Error("Workspace bootstrap returned an invalid variable");
  }
  process.stdout.write(`export ${key}=${shellQuote(value)}\n`);
}
