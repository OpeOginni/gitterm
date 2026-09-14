const OPENCODE_DATA_DIRECTORY =
  "${OPENCODE_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/opencode}";

/** Import GitTerm's short-lived credential seed into OpenCode V2's SQLite store. */
export const OPENCODE_V2_IMPORT_CREDENTIALS = `AUTH_FILE="${OPENCODE_DATA_DIRECTORY}/auth.json"
if [ -f "$AUTH_FILE" ]; then
  opencode auth list --standalone >/dev/null
  export AUTH_FILE
  python3 - <<'PY'
import json
import os
import secrets
import sqlite3
import time

auth_file = os.environ["AUTH_FILE"]
database_file = os.path.join(os.path.dirname(auth_file), "opencode.db")
with open(auth_file, encoding="utf-8") as handle:
    seed = json.load(handle)
if not isinstance(seed, dict):
    raise ValueError("OpenCode credential seed must be an object")

credentials = []
for raw_id, raw in seed.items():
    integration_id = raw_id.rstrip("/") if isinstance(raw_id, str) else ""
    if not integration_id or not isinstance(raw, dict):
        raise ValueError("OpenCode credential seed contains an invalid entry")
    credential_type = raw.get("type")
    if credential_type == "api" and isinstance(raw.get("key"), str):
        value = {"type": "key", "key": raw["key"]}
        if isinstance(raw.get("metadata"), dict):
            value["metadata"] = raw["metadata"]
        label = "API key"
    elif (
        credential_type == "oauth"
        and isinstance(raw.get("refresh"), str)
        and isinstance(raw.get("access"), str)
        and isinstance(raw.get("expires"), int)
        and not isinstance(raw.get("expires"), bool)
        and raw["expires"] >= 0
    ):
        method_id = "chatgpt-browser" if integration_id == "openai" else (
            "device" if integration_id in {"github-copilot", "opencode", "xai"} else "oauth"
        )
        value = {
            "type": "oauth",
            "methodID": method_id,
            "refresh": raw["refresh"],
            "access": raw["access"],
            "expires": raw["expires"],
        }
        metadata = {}
        if isinstance(raw.get("accountId"), str):
            metadata["accountID"] = raw["accountId"]
        if isinstance(raw.get("enterpriseUrl"), str):
            metadata["enterpriseUrl"] = raw["enterpriseUrl"]
        if metadata:
            value["metadata"] = metadata
        label = "OAuth"
    else:
        raise ValueError(f"Unsupported OpenCode credential seed for {integration_id}")
    credentials.append((integration_id, label, json.dumps(value, separators=(",", ":"))))

now = int(time.time() * 1000)
with sqlite3.connect(database_file) as database:
    for integration_id, label, value in credentials:
        exists = database.execute(
            "SELECT 1 FROM credential WHERE integration_id = ? LIMIT 1", (integration_id,)
        ).fetchone()
        if exists:
            continue
        database.execute(
            "INSERT INTO credential "
            "(id, integration_id, label, value, active, time_created, time_updated) "
            "VALUES (?, ?, ?, ?, 1, ?, ?)",
            ("cred_" + secrets.token_hex(16), integration_id, label, value, now, now),
        )
    missing = [
        integration_id
        for integration_id, _, _ in credentials
        if not database.execute(
            "SELECT 1 FROM credential WHERE integration_id = ? LIMIT 1", (integration_id,)
        ).fetchone()
    ]
    if missing:
        raise RuntimeError("OpenCode credential import verification failed")
PY
  rm -f "$AUTH_FILE"
fi`;
