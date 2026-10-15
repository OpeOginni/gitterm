#!/bin/sh
set -eu
export LANG=C.UTF-8
# One shared terminal per workspace. Disconnecting detaches only the tmux client.
# This survives browser/network loss, not container termination.
# Use the image's V2 executable, not an older persisted ~/.bun/bin installation.
# `opencode --version` prints e.g. "opencode v2.0.29"; extract just the semver.
version=$(/usr/local/bin/opencode --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
case "$version" in
  2.*) ;;
  *) printf 'GitTerm requires OpenCode 2.x; found %s. Rebuild the OpenCode runtime image.\n' "${version:-unknown}" >&2; exit 1 ;;
esac
# A distinct name avoids reattaching an old V1 process after an upgrade.
exec tmux -u -L gitterm -f /etc/gitterm-tmux.conf new-session -A -s workspace-v2 \
  '/usr/local/bin/opencode; exec bash'
