/**
 * How a workspace installs its agent on a plain image: the default for every provider. An
 * admin can instead start an image from a prebuilt snapshot or template that has the agent
 * (image metadata `snapshot`, or E2B `templateId`), which skips these commands.
 *
 * Everything goes to `~/.local`, so it works without root. The workspace runs the agent and
 * its commands with `~/.local/bin` first on PATH.
 */

const NODE_VERSION = "24.11.1";

/**
 * Makes Node 22.19 or newer available: the image's own if it has one, otherwise Node
 * 24 from nodejs.org in `~/.local`.
 */
export const ENSURE_NODE_COMMAND = [
  'export PATH="$HOME/.local/bin:$PATH"',
  "if ! node -e 'const [a, b] = process.versions.node.split(\".\").map(Number); process.exit(a > 22 || (a === 22 && b >= 19) ? 0 : 1)' 2>/dev/null; then",
  '  case "$(uname -m)" in x86_64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) echo "No Node build for $(uname -m)." >&2; exit 1 ;; esac',
  '  mkdir -p "$HOME/.local/node" "$HOME/.local/bin"',
  `  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-$arch.tar.gz" | tar -xz -C "$HOME/.local/node" --strip-components=1`,
  '  for bin in node npm npx; do ln -sf "$HOME/.local/node/bin/$bin" "$HOME/.local/bin/$bin"; done',
  "fi",
].join("\n");

/** Installs npm packages (and Node, when needed) into `~/.local`. */
export function npmInstallCommand(packages: string[]): string {
  return [
    "set -e",
    ENSURE_NODE_COMMAND,
    `npm install -g --prefix "$HOME/.local" --no-audit --fund=false ${packages.join(" ")}`,
  ].join("\n");
}
