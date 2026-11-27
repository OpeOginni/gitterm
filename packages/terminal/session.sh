#!/bin/sh
# What each browser connection runs, as `sh session.sh '<agent command>' [URL arguments]`.
# Every browser attaches to one tmux session that runs the agent, so it keeps running when the
# browser closes (not when the machine stops). Leaving the agent leaves a shell.
# `upload <name> <size>` from the page saves a file instead: <size> base64 bytes come in on
# stdin, and the saved path goes back on stdout.
set -eu
export LANG="${LANG:-C.UTF-8}"
dir=$(cd "$(dirname "$0")" && pwd)
command=$1
shift

if [ "${1-}" = upload ]; then
  name=$(printf %s "${2:-file}" | tr -c 'A-Za-z0-9._-' '_')
  case $name in "" | . | ..) name=file ;; esac
  mkdir -p "$HOME/.gitterm/uploads"
  # A new folder per upload, so files with the same name never overwrite each other.
  path="$(mktemp -d "$HOME/.gitterm/uploads/XXXXXXXX")/$name"
  stty raw -echo
  printf 'ready\n'
  head -c "${3:?}" | base64 -d > "$path"
  printf '\nsaved %s\n' "$path"
  exit
fi

if command -v tmux >/dev/null; then
  exec tmux -u -f "$dir/tmux.conf" new-session -A -s agent "$command; exec \"\${SHELL:-sh}\" -l"
fi
exec sh -c "$command; exec \"\${SHELL:-sh}\" -l"
