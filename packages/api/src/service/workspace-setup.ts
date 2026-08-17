import { asc, db, eq } from "@gitterm/db";
import { workspaceSetupCommandDefault } from "@gitterm/db/schema/workspace-setup";

export const AWS_CLI_SETUP_COMMAND = `if ! command -v aws >/dev/null 2>&1; then
  tmp_dir=$(mktemp -d)
  case "$(uname -m)" in
    aarch64|arm64) aws_arch=aarch64 ;;
    *) aws_arch=x86_64 ;;
  esac
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$aws_arch.zip" -o "$tmp_dir/awscliv2.zip"
  unzip -q "$tmp_dir/awscliv2.zip" -d "$tmp_dir"
  "$tmp_dir/aws/install" --update
  rm -rf "$tmp_dir"
fi`;

export async function resolveWorkspaceSetupCommands(input: {
  cloudProviderId: string;
  agentTypeId: string;
  requestedCommands?: string[];
}): Promise<string[]> {
  const defaults = await db.query.workspaceSetupCommandDefault.findMany({
    where: eq(workspaceSetupCommandDefault.cloudProviderId, input.cloudProviderId),
    orderBy: [asc(workspaceSetupCommandDefault.createdAt)],
  });

  const providerCommands = defaults.find((entry) => entry.agentTypeId === null)?.commands ?? [];
  const agentCommands =
    defaults.find((entry) => entry.agentTypeId === input.agentTypeId)?.commands ?? [];

  return [...providerCommands, ...agentCommands, ...(input.requestedCommands ?? [])];
}

/**
 * Build a restart-safe, non-blocking workspace setup script. Providers launch
 * this script from the repository directory and never wait for its completion.
 */
export function buildWorkspaceSetupCommand(
  commands: string[],
  fallbackPort = 7681,
): string | undefined {
  if (commands.length === 0) return undefined;

  const body = commands.join("\n");
  const encoded = Buffer.from(body).toString("base64");
  const script = [
    'SETUP_DIR="$PWD/.gitterm/setup"',
    'mkdir -p "$SETUP_DIR"',
    'if [ -d .git/info ]; then grep -qxF "/.gitterm/" .git/info/exclude 2>/dev/null || printf "/.gitterm/\\n" >> .git/info/exclude; fi',
    'if [ "$(cat "$SETUP_DIR/state" 2>/dev/null)" = "succeeded" ]; then exit 0; fi',
    "BOOT_ID=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || printf unknown)",
    'if ! mkdir "$SETUP_DIR/claim" 2>/dev/null; then OLD_BOOT_ID=$(cat "$SETUP_DIR/claim/boot-id" 2>/dev/null || true); OLD_PID=$(cat "$SETUP_DIR/claim/pid" 2>/dev/null || true); if [ "$OLD_BOOT_ID" = "$BOOT_ID" ] && [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then exit 0; fi; rm -rf "$SETUP_DIR/claim"; mkdir "$SETUP_DIR/claim" 2>/dev/null || exit 0; fi',
    'printf "%s\n" "$BOOT_ID" > "$SETUP_DIR/claim/boot-id"',
    'printf "%s\n" "$$" > "$SETUP_DIR/claim/pid"',
    "trap 'rm -rf \"$SETUP_DIR/claim\"' EXIT HUP INT TERM",
    'printf "waiting\\n" > "$SETUP_DIR/state"',
    `SETUP_PORT="\${PORT:-${fallbackPort}}"`,
    "ready=0",
    'for attempt in $(seq 1 150); do status=$(curl -sS -o /dev/null -w "%{http_code}" "http://127.0.0.1:$SETUP_PORT" 2>/dev/null || true); case "$status" in [234][0-9][0-9]) ready=1; break ;; esac; sleep 2; done',
    'if [ "$ready" -ne 1 ]; then printf "Agent did not become ready on port %s\\n" "$SETUP_PORT" > "$SETUP_DIR/setup.log"; printf "failed\\n" > "$SETUP_DIR/state"; exit 0; fi',
    'printf "running\\n" > "$SETUP_DIR/state"',
    'date -u +%Y-%m-%dT%H:%M:%SZ > "$SETUP_DIR/started-at"',
    `printf '%s' '${encoded}' | base64 -d > "$SETUP_DIR/script.sh"`,
    'chmod 700 "$SETUP_DIR/script.sh"',
    '(bash -e "$SETUP_DIR/script.sh" > "$SETUP_DIR/setup.log" 2>&1)',
    "code=$?",
    'printf "%s\\n" "$code" > "$SETUP_DIR/exit-code"',
    'date -u +%Y-%m-%dT%H:%M:%SZ > "$SETUP_DIR/finished-at"',
    'if [ "$code" -eq 0 ]; then printf "succeeded\\n" > "$SETUP_DIR/state"; else printf "failed\\n" > "$SETUP_DIR/state"; fi',
    "exit 0",
  ].join("; ");

  return `( ${script} ) >/dev/null 2>&1 &`;
}
