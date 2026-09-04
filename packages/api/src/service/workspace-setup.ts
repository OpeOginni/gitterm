import { asc, db, eq } from "@gitterm/db";
import { workspaceSetup, workspaceSetupCommandDefault } from "@gitterm/db/schema/workspace-setup";
import { reconcileWorkspaceSetupStatus } from "./workspace-setup-reconcile";

export type WorkspaceSetupStatus = {
  status: "not_requested" | "waiting" | "running" | "succeeded" | "failed";
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  log: string | null;
};

/**
 * Shell command that adds repository-relative paths to `.git/info/exclude` so
 * an agent running `git add -A` cannot commit provisioned secret files.
 */
export function buildGitExcludeCommand(paths: string[]): string | undefined {
  if (paths.length === 0) return undefined;
  const entries = paths.map((path) => `'/${path.replaceAll("'", `'"'"'`)}'`).join(" ");
  return `if [ -d .git/info ]; then for p in ${entries}; do grep -qxF "$p" .git/info/exclude 2>/dev/null || printf '%s\\n' "$p" >> .git/info/exclude; done; fi`;
}

export const AWS_CLI_SETUP_COMMAND = `if ! command -v aws >/dev/null 2>&1; then
  tmp_dir=$(mktemp -d)
  aws_install_dir="$HOME/.gitterm/aws-cli"
  aws_bin_dir="$HOME/.bun/bin"
  case "$(uname -m)" in
    aarch64|arm64) aws_arch=aarch64 ;;
    *) aws_arch=x86_64 ;;
  esac
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$aws_arch.zip" -o "$tmp_dir/awscliv2.zip"
  unzip -q "$tmp_dir/awscliv2.zip" -d "$tmp_dir"
  mkdir -p "$aws_install_dir" "$aws_bin_dir"
  "$tmp_dir/aws/install" --install-dir "$aws_install_dir" --bin-dir "$aws_bin_dir" --update
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
  options?: {
    executionId?: string;
    /**
     * Skip push reports entirely (their retry backoff delays setup by ~30s
     * per report). Use when the workspace cannot reach the API and status is
     * reconciled by server-side polling instead.
     */
    disablePush?: boolean;
    phase?: "before-agent" | "after-agent";
    waitForAgent?: boolean;
    detached?: boolean;
    failOnError?: boolean;
  },
): string | undefined {
  if (commands.length === 0) return undefined;

  const body = commands.join("\n");
  const encoded = Buffer.from(body).toString("base64");
  const reportFunction =
    options?.executionId && !options.disablePush
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
  const phase = options?.phase ?? "after-agent";
  const readiness =
    options?.waitForAgent === false
      ? []
      : [
          `SETUP_PORT="\${WORKSPACE_SETUP_PORT:-\${PORT:-${fallbackPort}}}"`,
          "ready=0",
          'for attempt in $(seq 1 150); do status=$(curl -sS --connect-timeout 2 --max-time 2 -o /dev/null -w "%{http_code}" "http://127.0.0.1:$SETUP_PORT" 2>/dev/null || true); case "$status" in [234][0-9][0-9]) ready=1; break ;; esac; sleep 2; done',
          'if [ "$ready" -ne 1 ]; then date -u +%Y-%m-%dT%H:%M:%SZ > "$SETUP_DIR/finished-at"; printf "Agent did not become ready on port %s\\n" "$SETUP_PORT" > "$SETUP_DIR/setup.log"; printf "124\\n" > "$SETUP_DIR/exit-code"; printf "failed\\n" > "$SETUP_DIR/state"; SETUP_FINISHED=$(cat "$SETUP_DIR/finished-at"); SETUP_LOG=$(base64 < "$SETUP_DIR/setup.log" | tr -d "\\n"); report_setup failed 124 null "\\"$SETUP_FINISHED\\"" "$SETUP_LOG" || true; exit 0; fi',
        ];
  const script = [
    `SETUP_DIR="$PWD/.gitterm/setup/${phase}"`,
    'mkdir -p "$SETUP_DIR"',
    reportFunction,
    'if [ -d .git/info ]; then grep -qxF "/.gitterm/" .git/info/exclude 2>/dev/null || printf "/.gitterm/\\n" >> .git/info/exclude; fi',
    'SETUP_STATE=$(cat "$SETUP_DIR/state" 2>/dev/null || true); if [ "$SETUP_STATE" = "succeeded" ] || [ "$SETUP_STATE" = "failed" ]; then SETUP_CODE=$(cat "$SETUP_DIR/exit-code" 2>/dev/null || printf 1); SETUP_STARTED=$(cat "$SETUP_DIR/started-at" 2>/dev/null || printf null); SETUP_FINISHED=$(cat "$SETUP_DIR/finished-at" 2>/dev/null || printf null); SETUP_LOG=$(tail -c 50000 "$SETUP_DIR/setup.log" 2>/dev/null | base64 | tr -d "\\n"); report_setup "$SETUP_STATE" "$SETUP_CODE" "\\"$SETUP_STARTED\\"" "\\"$SETUP_FINISHED\\"" "$SETUP_LOG" || true; exit 0; fi',
    "BOOT_ID=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || printf unknown)",
    'if ! mkdir "$SETUP_DIR/claim" 2>/dev/null; then OLD_BOOT_ID=$(cat "$SETUP_DIR/claim/boot-id" 2>/dev/null || true); OLD_PID=$(cat "$SETUP_DIR/claim/pid" 2>/dev/null || true); if [ "$OLD_BOOT_ID" = "$BOOT_ID" ] && [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then exit 0; fi; rm -rf "$SETUP_DIR/claim"; mkdir "$SETUP_DIR/claim" 2>/dev/null || exit 0; fi',
    'printf "%s\n" "$BOOT_ID" > "$SETUP_DIR/claim/boot-id"',
    'printf "%s\n" "${BASHPID:-$$}" > "$SETUP_DIR/claim/pid"',
    "trap 'rm -rf \"$SETUP_DIR/claim\"' EXIT HUP INT TERM",
    'printf "waiting\\n" > "$SETUP_DIR/state"',
    ...readiness,
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
    // Blocking phases surface their log through the provisioning error, so echo the tail to stderr.
    ...(options?.failOnError
      ? ['if [ "$code" -ne 0 ]; then tail -c 4000 "$SETUP_DIR/setup.log" >&2; fi']
      : []),
    'SETUP_STATUS=$(cat "$SETUP_DIR/state"); SETUP_STARTED=$(cat "$SETUP_DIR/started-at"); SETUP_FINISHED=$(cat "$SETUP_DIR/finished-at"); SETUP_LOG=$(tail -c 50000 "$SETUP_DIR/setup.log" | base64 | tr -d "\\n"); report_setup "$SETUP_STATUS" "$code" "\\"$SETUP_STARTED\\"" "\\"$SETUP_FINISHED\\"" "$SETUP_LOG" || true',
    options?.failOnError ? 'exit "$code"' : "exit 0",
  ].join("\n");

  return options?.detached === false ? `( ${script} )` : `( ${script} ) >/dev/null 2>&1 &`;
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

  let record = await db.query.workspaceSetup.findFirst({
    where: eq(workspaceSetup.workspaceId, workspaceId),
  });
  if (record && record.status !== "succeeded" && record.status !== "failed") {
    // Pull-based fallback for providers whose sandboxes cannot push reports
    // (throttled internally; a no-op for providers that can reach the API).
    const polled = await reconcileWorkspaceSetupStatus(workspaceId);
    if (polled) {
      record = await db.query.workspaceSetup.findFirst({
        where: eq(workspaceSetup.workspaceId, workspaceId),
      });
    }
  }
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
