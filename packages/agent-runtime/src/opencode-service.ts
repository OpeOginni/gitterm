/**
 * OpenCode 2's CLI talks to a "background service" it finds through a
 * registration file, and starts its own `opencode serve --service` when none is
 * registered. In a workspace that second server shares the agent server's data
 * directory and also picks up prompts, so every step runs twice. Registering the
 * agent server itself makes CLI commands (setup scripts, the agent's own shell)
 * reuse it instead.
 */
export const OPENCODE_SERVICE_REGISTRAR_PATH = "~/.gitterm/opencode/register-service.sh";

/**
 * Waits for the local server (up to `$2` half-second attempts, default 5 minutes),
 * then writes OpenCode's registration file from its `/api/info` (the pid must
 * match). Rewritten on every start, since the pid changes.
 */
export const OPENCODE_SERVICE_REGISTRAR_SCRIPT = `#!/bin/sh
port="$1"
attempts="\${2:-600}"
[ -n "$port" ] || exit 0
command -v curl >/dev/null 2>&1 || exit 0
info=""
attempt=0
while [ "$attempt" -lt "$attempts" ]; do
  if [ -n "$OPENCODE_SERVER_PASSWORD" ]; then
    info=$(curl -sf --max-time 2 -u "opencode:$OPENCODE_SERVER_PASSWORD" "http://127.0.0.1:$port/api/info" 2>/dev/null) && break
  else
    info=$(curl -sf --max-time 2 "http://127.0.0.1:$port/api/info" 2>/dev/null) && break
  fi
  attempt=$((attempt + 1))
  sleep 0.5
done
pid=$(printf '%s' "$info" | sed -n 's/.*"pid":\\([0-9][0-9]*\\).*/\\1/p')
version=$(printf '%s' "$info" | sed -n 's/.*"version":"\\([^"]*\\)".*/\\1/p')
[ -n "$pid" ] || exit 0
dir="\${XDG_STATE_HOME:-$HOME/.local/state}/opencode"
mkdir -p "$dir" || exit 0
umask 077
password=""
[ -n "$OPENCODE_SERVER_PASSWORD" ] && password=",\\"password\\":\\"$OPENCODE_SERVER_PASSWORD\\""
printf '{"url":"http://127.0.0.1:%s","pid":%s,"version":"%s"%s}\\n' "$port" "$pid" "$version" "$password" > "$dir/service.json.$$" &&
  mv "$dir/service.json.$$" "$dir/service.json"
`;

/** `opencode serve` that registers itself; still contains `opencode serve` for detection. */
export function opencodeServeCommand(port: number): string {
  const registrar = OPENCODE_SERVICE_REGISTRAR_PATH.replace(/^~/, "$HOME");
  return `sh -c 'sh "${registrar}" ${port} >/dev/null 2>&1 & exec opencode serve --hostname 0.0.0.0 --port ${port}'`;
}

/** Whether a serve command launches OpenCode (registered or not). */
export function isOpencodeServeCommand(command: string): boolean {
  return /(^|\s|')opencode serve\b/.test(command.trim());
}
