import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPENCODE_V2_IMPORT_CREDENTIALS } from "./opencode-credentials";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

test("imports API and OAuth seeds into SQLite before deleting auth.json", () => {
  const home = mkdtempSync(join(tmpdir(), "gitterm-opencode-v2-import-"));
  directories.push(home);
  const data = join(home, ".local/share/opencode");
  const bin = join(home, "bin");
  const database = join(data, "opencode.db");
  const auth = join(data, "auth.json");
  mkdirSync(data, { recursive: true });
  mkdirSync(bin);
  writeFileSync(
    auth,
    JSON.stringify({
      anthropic: { type: "api", key: "api-key" },
      openai: { type: "oauth", refresh: "refresh", access: "", expires: 0 },
    }),
  );
  writeFileSync(
    join(bin, "opencode"),
    `#!/bin/sh
test "$1 $2 $3" = "auth list --standalone"
python3 - "$HOME/.local/share/opencode/opencode.db" <<'PY'
import sqlite3
import sys
with sqlite3.connect(sys.argv[1]) as database:
    database.execute("CREATE TABLE credential (id TEXT PRIMARY KEY, integration_id TEXT, label TEXT NOT NULL, value TEXT NOT NULL, active INTEGER, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL)")
PY
`,
  );
  chmodSync(join(bin, "opencode"), 0o755);

  const imported = Bun.spawnSync(["bash", "-c", OPENCODE_V2_IMPORT_CREDENTIALS], {
    env: {
      ...process.env,
      HOME: home,
      XDG_DATA_HOME: join(home, ".local/share"),
      PATH: `${bin}:${process.env.PATH}`,
    },
  });
  expect(imported.exitCode).toBe(0);
  expect(imported.stderr.toString()).toBe("");
  expect(existsSync(auth)).toBe(false);

  const result = Bun.spawnSync([
    "python3",
    "-c",
    "import json,sqlite3,sys; database=sqlite3.connect(sys.argv[1]); print(json.dumps(database.execute('SELECT integration_id,label,value,active FROM credential ORDER BY integration_id').fetchall()))",
    database,
  ]);
  expect(JSON.parse(result.stdout.toString())).toEqual([
    ["anthropic", "API key", '{"type":"key","key":"api-key"}', 1],
    [
      "openai",
      "OAuth",
      '{"type":"oauth","methodID":"chatgpt-browser","refresh":"refresh","access":"","expires":0}',
      1,
    ],
  ]);
});
