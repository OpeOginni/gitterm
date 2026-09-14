#!/bin/sh

repo_dir="$1"
phase="${2:-after-agent}"
if [ "$phase" = "before-agent" ]; then
  encoded_command="${WORKSPACE_BEFORE_AGENT_COMMAND_BASE64:-}"
else
  encoded_command="${WORKSPACE_SETUP_COMMAND_BASE64:-}"
fi
strict="${GITTERM_WORKSPACE_SETUP_STRICT:-}"

if [ -z "$encoded_command" ]; then
  exit 0
fi

runtime_dir="/run/gitterm"
mkdir -p "$runtime_dir"
command_file="$runtime_dir/workspace-setup.sh"

if ! printf '%s' "$encoded_command" | base64 -d > "$command_file" 2>/dev/null; then
  echo "Invalid workspace setup command payload" >&2
  if [ "$strict" = "1" ]; then
    exit 1
  fi
  exit 0
fi

chmod 700 "$command_file"
# Only the detached after-agent phase needs to yield to the agent process first;
# the blocking before-agent phase runs on the startup critical path.
if [ "$phase" != "before-agent" ]; then
  sleep "${WORKSPACE_SETUP_DELAY_SECONDS:-2}"
fi
if [ "$strict" = "1" ]; then
  # Blocking phase: the time spent here delays readiness, so report it.
  setup_started=$(date +%s)
  echo "[gitterm-startup] $phase setup started"
  cd "$repo_dir" || exit 1
  sh "$command_file"
  setup_code=$?
  echo "[gitterm-startup] $phase setup finished exitCode=$setup_code durationSeconds=$(( $(date +%s) - setup_started ))"
  exit "$setup_code"
fi
# Non-strict phases detach themselves; only the launch is observable here.
cd "$repo_dir" || exit 0
echo "[gitterm-startup] $phase setup launched"
sh "$command_file" || true
