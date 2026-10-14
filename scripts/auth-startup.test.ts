import { expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

async function authPlugins(mode: "self-hosted" | "managed", polar = false) {
  const child = Bun.spawn(
    [
      process.execPath,
      "--no-env-file",
      "-e",
      `const { auth } = await import(${JSON.stringify(resolve(root, "packages/auth/src/index.ts"))});
console.log(JSON.stringify(auth.options.plugins.map((plugin) => plugin.id)));`,
    ],
    {
      cwd: root,
      env: {
        NODE_ENV: "production",
        DEPLOYMENT_MODE: mode,
        DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test",
        BASE_DOMAIN: "example.com",
        BETTER_AUTH_URL: "https://example.com",
        BETTER_AUTH_SECRET: "auth-startup-test-secret-not-for-production",
        ...(polar
          ? {
              POLAR_ACCESS_TOKEN: "polar-startup-test-token",
              POLAR_PRO_PRODUCT_ID: "polar-startup-test-product",
              POLAR_WEBHOOK_SECRET: "polar-startup-test-webhook-secret",
            }
          : {}),
        DOTENV_CONFIG_PATH: resolve(root, ".auth-startup-test-no-env"),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const timer = setTimeout(() => child.kill(), 10_000);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exitCode, stderr).toBe(0);
    return JSON.parse(stdout.trim()) as string[];
  } finally {
    clearTimeout(timer);
    child.kill();
  }
}

test("self-hosted auth starts without Polar credentials", async () => {
  expect(await authPlugins("self-hosted")).toEqual(["next-cookies"]);
});

test("self-hosted auth does not enable billing even with Polar credentials", async () => {
  expect(await authPlugins("self-hosted", true)).toEqual(["next-cookies"]);
});

test("managed auth retains Polar and keeps nextCookies last", async () => {
  expect(await authPlugins("managed", true)).toEqual(["polar", "next-cookies"]);
});

test("managed auth starts without Polar when billing is not configured", async () => {
  expect(await authPlugins("managed")).toEqual(["next-cookies"]);
});
