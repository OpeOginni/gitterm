import { asc, db, eq } from "@gitterm/db";
import { workspaceSetup, workspaceSetupCommandDefault } from "@gitterm/db/schema/workspace-setup";

export type WorkspaceSetupStatus = {
  status: "not_requested" | "waiting" | "running" | "succeeded" | "failed";
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  log: string | null;
};

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

export function withWorkspaceSetupPort(command: string, port: number): string {
  return `export WORKSPACE_SETUP_PORT=${port}\n${command}`;
}

/**
 * Build a restart-safe, non-blocking workspace setup script. Providers launch
 * this script from the repository directory and never wait for its completion.
 */
export function buildWorkspaceSetupCommand(
  commands: string[],
  fallbackPort = 7681,
  options?: { executionId?: string },
): string | undefined {
  if (commands.length === 0) return undefined;

  const body = commands.join("\n");
  const encoded = Buffer.from(body).toString("base64");
  const reportFunction = options?.executionId
    ? [
        "report_setup() {",
        '  [ -n "$WORKSPACE_API_URL" ] && [ -n "$WORKSPACE_SETUP_AUTH_TOKEN" ] || return 0',
        '  REPORT_STATUS="$1"; REPORT_EXIT="$2"; REPORT_STARTED="$3"; REPORT_FINISHED="$4"; REPORT_LOG="$5"',
        `  REPORT_PAYLOAD=$(printf '{"executionId":"${options.executionId}","status":"%s","exitCode":%s,"startedAt":%s,"finishedAt":%s,"logBase64":"%s"}' "$REPORT_STATUS" "$REPORT_EXIT" "$REPORT_STARTED" "$REPORT_FINISHED" "$REPORT_LOG")`,
        "  for REPORT_DELAY in 0 1 2 4 8 16; do",
        '    [ "$REPORT_DELAY" -eq 0 ] || sleep "$REPORT_DELAY"',
        '    REPORT_HTTP=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "${WORKSPACE_API_URL%/}/workspaceOps.reportSetupStatus" -H "Authorization: Bearer $WORKSPACE_SETUP_AUTH_TOKEN" -H "Content-Type: application/json" --data "$REPORT_PAYLOAD" 2>/dev/null || true)',
        '    case "$REPORT_HTTP" in 2[0-9][0-9]) return 0 ;; 404|408|409|429|5[0-9][0-9]|000) ;; *) return 1 ;; esac',
        "  done",
        "  return 1",
        "}",
      ].join("\n")
    : "report_setup() { return 0; }";
  const script = [
    'SETUP_DIR="$PWD/.gitterm/setup"',
    'mkdir -p "$SETUP_DIR"',
    reportFunction,
    'if [ -d .git/info ]; then grep -qxF "/.gitterm/" .git/info/exclude 2>/dev/null || printf "/.gitterm/\\n" >> .git/info/exclude; fi',
    'SETUP_STATE=$(cat "$SETUP_DIR/state" 2>/dev/null || true); if [ "$SETUP_STATE" = "succeeded" ] || [ "$SETUP_STATE" = "failed" ]; then SETUP_CODE=$(cat "$SETUP_DIR/exit-code" 2>/dev/null || printf 1); SETUP_STARTED=$(cat "$SETUP_DIR/started-at" 2>/dev/null || printf null); SETUP_FINISHED=$(cat "$SETUP_DIR/finished-at" 2>/dev/null || printf null); SETUP_LOG=$(tail -c 50000 "$SETUP_DIR/setup.log" 2>/dev/null | base64 | tr -d "\\n"); report_setup "$SETUP_STATE" "$SETUP_CODE" "\\"$SETUP_STARTED\\"" "\\"$SETUP_FINISHED\\"" "$SETUP_LOG" || true; exit 0; fi',
    "BOOT_ID=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || printf unknown)",
    'if ! mkdir "$SETUP_DIR/claim" 2>/dev/null; then OLD_BOOT_ID=$(cat "$SETUP_DIR/claim/boot-id" 2>/dev/null || true); OLD_PID=$(cat "$SETUP_DIR/claim/pid" 2>/dev/null || true); if [ "$OLD_BOOT_ID" = "$BOOT_ID" ] && [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then exit 0; fi; rm -rf "$SETUP_DIR/claim"; mkdir "$SETUP_DIR/claim" 2>/dev/null || exit 0; fi',
    'printf "%s\n" "$BOOT_ID" > "$SETUP_DIR/claim/boot-id"',
    'printf "%s\n" "$$" > "$SETUP_DIR/claim/pid"',
    "trap 'rm -rf \"$SETUP_DIR/claim\"' EXIT HUP INT TERM",
    'printf "waiting\\n" > "$SETUP_DIR/state"',
    `SETUP_PORT="\${WORKSPACE_SETUP_PORT:-\${PORT:-${fallbackPort}}}"`,
    "ready=0",
    'for attempt in $(seq 1 150); do status=$(curl -sS -o /dev/null -w "%{http_code}" "http://127.0.0.1:$SETUP_PORT" 2>/dev/null || true); case "$status" in [234][0-9][0-9]) ready=1; break ;; esac; sleep 2; done',
    'if [ "$ready" -ne 1 ]; then date -u +%Y-%m-%dT%H:%M:%SZ > "$SETUP_DIR/finished-at"; printf "Agent did not become ready on port %s\\n" "$SETUP_PORT" > "$SETUP_DIR/setup.log"; printf "124\\n" > "$SETUP_DIR/exit-code"; printf "failed\\n" > "$SETUP_DIR/state"; SETUP_FINISHED=$(cat "$SETUP_DIR/finished-at"); SETUP_LOG=$(base64 < "$SETUP_DIR/setup.log" | tr -d "\\n"); report_setup failed 124 null "\\"$SETUP_FINISHED\\"" "$SETUP_LOG" || true; exit 0; fi',
    'printf "running\\n" > "$SETUP_DIR/state"',
    'date -u +%Y-%m-%dT%H:%M:%SZ > "$SETUP_DIR/started-at"',
    'SETUP_STARTED=$(cat "$SETUP_DIR/started-at"); report_setup running null "\\"$SETUP_STARTED\\"" null "" || true',
    `printf '%s' '${encoded}' | base64 -d > "$SETUP_DIR/script.sh"`,
    'chmod 700 "$SETUP_DIR/script.sh"',
    '(bash -e "$SETUP_DIR/script.sh" > "$SETUP_DIR/setup.log" 2>&1)',
    "code=$?",
    'printf "%s\\n" "$code" > "$SETUP_DIR/exit-code"',
    'date -u +%Y-%m-%dT%H:%M:%SZ > "$SETUP_DIR/finished-at"',
    'if [ "$code" -eq 0 ]; then printf "succeeded\\n" > "$SETUP_DIR/state"; else printf "failed\\n" > "$SETUP_DIR/state"; fi',
    'SETUP_STATUS=$(cat "$SETUP_DIR/state"); SETUP_STARTED=$(cat "$SETUP_DIR/started-at"); SETUP_FINISHED=$(cat "$SETUP_DIR/finished-at"); SETUP_LOG=$(tail -c 50000 "$SETUP_DIR/setup.log" | base64 | tr -d "\\n"); report_setup "$SETUP_STATUS" "$code" "\\"$SETUP_STARTED\\"" "\\"$SETUP_FINISHED\\"" "$SETUP_LOG" || true',
    "exit 0",
  ].join("\n");

  return `( ${script} ) >/dev/null 2>&1 &`;
}

export async function getWorkspaceSetupStatus(
  workspaceId: string,
  setupRequired = true,
): Promise<WorkspaceSetupStatus> {
  if (!setupRequired) {
    return {
      status: "not_requested",
      exitCode: null,
      startedAt: null,
      finishedAt: null,
      log: null,
    };
  }

  const record = await db.query.workspaceSetup.findFirst({
    where: eq(workspaceSetup.workspaceId, workspaceId),
  });
  if (!record) {
    return {
      status: "waiting",
      exitCode: null,
      startedAt: null,
      finishedAt: null,
      log: null,
    };
  }

  return {
    status: record.status,
    exitCode: record.exitCode,
    startedAt: record.startedAt?.toISOString() ?? null,
    finishedAt: record.finishedAt?.toISOString() ?? null,
    log: record.log,
  };
}
