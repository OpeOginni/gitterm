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
    'SETUP_DIR="${HOME:-/tmp}/.gitterm/setup"',
    'mkdir -p "$SETUP_DIR"',
    'if ! mkdir "$SETUP_DIR/claim" 2>/dev/null; then exit 0; fi',
    'printf "waiting\\n" > "$SETUP_DIR/state"',
    `SETUP_PORT="\${PORT:-${fallbackPort}}"`,
    "ready=0",
    'for attempt in $(seq 1 150); do if curl -fsS "http://127.0.0.1:$SETUP_PORT" >/dev/null 2>&1; then ready=1; break; fi; sleep 2; done',
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
