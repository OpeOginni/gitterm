#!/bin/sh
set -e

WORKSPACE="/workspace"
RUNTIME_DIR="/run/gitterm"
GIT_CREDENTIAL_HELPER="$RUNTIME_DIR/git-credential-helper.sh"
USER_GITHUB_USERNAME="${USER_GITHUB_USERNAME}"
GITHUB_APP_TOKEN="${GITHUB_APP_TOKEN}"
GITHUB_APP_TOKEN_EXPIRY="${GITHUB_APP_TOKEN_EXPIRY}"
USER_EMAIL="${USER_EMAIL:-${USER_GITHUB_USERNAME}@users.noreply.github.com}"
REPO_BRANCH="${REPO_BRANCH}"

# Ensure workspace exists
mkdir -p "$WORKSPACE"
mkdir -p "$RUNTIME_DIR"
cd "$WORKSPACE"

ssh_enabled=0
case "${EDITOR_ACCESS_ENABLED}" in
  1|true|TRUE|yes|YES) ssh_enabled=1 ;;
esac
if [ -n "$USER_SSH_PUBLIC_KEY" ]; then
  ssh_enabled=1
fi

if [ "$ssh_enabled" = "1" ] && command -v sshd >/dev/null 2>&1; then
  mkdir -p /run/sshd /etc/ssh/sshd_config.d /etc/ssh/authorized_keys

  if [ -n "$USER_SSH_PUBLIC_KEY" ]; then
    touch /etc/ssh/authorized_keys/root
    chmod 600 /etc/ssh/authorized_keys/root
    chown root:root /etc/ssh/authorized_keys/root
    if ! grep -qxF "$USER_SSH_PUBLIC_KEY" /etc/ssh/authorized_keys/root 2>/dev/null; then
      printf '%s\n' "$USER_SSH_PUBLIC_KEY" >> /etc/ssh/authorized_keys/root
    fi
  fi

  cat > /etc/ssh/sshd_config.d/gitterm.conf <<EOF
PubkeyAuthentication yes
AuthorizedKeysFile /etc/ssh/authorized_keys/%u
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
UsePAM no
AllowTcpForwarding yes
AllowAgentForwarding yes
X11Forwarding no
ClientAliveInterval 30
ClientAliveCountMax 6
EOF

  ssh-keygen -A
  echo "Starting sshd on port 22..."
  /usr/sbin/sshd -D -e &
  SSHD_PID="$!"
  sleep 1
  if ! kill -0 "$SSHD_PID" 2>/dev/null; then
    echo "sshd failed to stay running" >&2
    exit 1
  fi
fi

########################################
# PERSISTENCE SETUP
########################################

# Create tool-specific directories if they don't exist
mkdir -p /workspace/.npm /workspace/.bun

# Bash history persistence
export HISTFILE=/workspace/.bash_history
export HISTSIZE=10000
export HISTFILESIZE=10000
export PATH=/workspace/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

########################################
# GIT CONFIGURATION (PERSISTENT)
# HOME is already set to /workspace above
########################################

# Set git config location explicitly
export GIT_CONFIG_GLOBAL=/workspace/.gitconfig

# Initialize .gitconfig if it doesn't exist
if [ ! -f "/workspace/.gitconfig" ]; then
    touch /workspace/.gitconfig
fi

if [ ! -z "$USER_GITHUB_USERNAME" ]; then
    git config --global user.name "$USER_GITHUB_USERNAME"
    git config --file /root/.gitconfig user.name "$USER_GITHUB_USERNAME"
fi

if [ ! -z "$USER_EMAIL" ]; then
    git config --global user.email "$USER_EMAIL"
    git config --file /root/.gitconfig user.email "$USER_EMAIL"
fi

if [ ! -z "$GITHUB_APP_TOKEN" ]; then
    echo "Configuring git with GitHub App authentication..."

    # Disable interactive credential helper
    git config --global credential.helper ''
    
    # Create runtime-only credential helper script
    # IMPORTANT: Use unquoted heredoc to expand $GITHUB_APP_TOKEN
    cat > "$GIT_CREDENTIAL_HELPER" <<CRED_HELPER
#!/bin/sh
if [ "\$1" = "get" ]; then
    echo "protocol=https"
    echo "host=github.com"
    echo "username=x-access-token"
    echo "password=${GITHUB_APP_TOKEN}"
fi
CRED_HELPER
    
    chmod 700 "$GIT_CREDENTIAL_HELPER"
    git config --global credential.helper "$GIT_CREDENTIAL_HELPER"
    
    echo "✓ Git configured with GitHub App token"
    echo "  Token expires at: $GITHUB_APP_TOKEN_EXPIRY"
else
    echo "⚠ No GitHub App token available - git operations will be limited"
fi

########################################
# FIRST-TIME SETUP
########################################
if [ ! -f ".initialized" ]; then
    echo "First-time workspace setup..."

    if [ ! -z "$REPO_URL" ]; then
        REPO_DIR_NAME="${REPO_NAME:-$(basename "$REPO_URL" .git)}"

        if [ -n "$REPO_BRANCH" ]; then
            echo "Cloning repo: $REPO_URL (branch: $REPO_BRANCH) into $REPO_DIR_NAME"
        else
            echo "Cloning repo: $REPO_URL into $REPO_DIR_NAME"
        fi
        
        # Prefer named checkout ref, then branch, for the initial clone.
        CLONE_REF="${REPO_CHECKOUT_REF:-$REPO_BRANCH}"

        # If GitHub App token is available, use authenticated URL
        if [ ! -z "$GITHUB_APP_TOKEN" ] && [ ! -z "$REPO_OWNER" ] && [ ! -z "$REPO_NAME" ]; then
            AUTH_URL="https://x-access-token:${GITHUB_APP_TOKEN}@github.com/${REPO_OWNER}/${REPO_NAME}.git"
            if [ -n "$CLONE_REF" ]; then
                git clone --branch "$CLONE_REF" --single-branch "$AUTH_URL" "$REPO_DIR_NAME"
            else
                git clone "$AUTH_URL" "$REPO_DIR_NAME"
            fi
        else
            # Fallback to original URL (public repos only)
            if [ -n "$CLONE_REF" ]; then
                git clone --branch "$CLONE_REF" --single-branch "$REPO_URL" "$REPO_DIR_NAME"
            else
                git clone "$REPO_URL" "$REPO_DIR_NAME"
            fi
        fi

        # Pin to exact base commit when provided (detached HEAD).
        if [ -n "$REPO_BASE_COMMIT" ]; then
            echo "Checking out base commit: $REPO_BASE_COMMIT"
            git -C "$REPO_DIR_NAME" fetch --depth 1 origin "$REPO_BASE_COMMIT"
            git -C "$REPO_DIR_NAME" cat-file -e "${REPO_BASE_COMMIT}^{commit}"
            git -C "$REPO_DIR_NAME" checkout --detach "$REPO_BASE_COMMIT"
            test "$(git -C "$REPO_DIR_NAME" rev-parse HEAD)" = "$REPO_BASE_COMMIT"
        fi
        
        echo "$REPO_OWNER" > .repo_owner
    else
        echo "No repo URL - using empty workspace."
        REPO_DIR_NAME="workspace"
        mkdir -p "$REPO_DIR_NAME"
        echo "" > .repo_owner
    fi

    echo "$REPO_DIR_NAME" > .repo_name

    # Write agent files (configs, credential stores) from the generic manifest.
    if [ ! -z "$AGENT_FILES_BASE64" ]; then
        echo "$AGENT_FILES_BASE64" | base64 -d > "$RUNTIME_DIR/agent-files.json"
        node <<'NODE'
const fs = require("fs");
const path = require("path");
const os = require("os");
const files = JSON.parse(fs.readFileSync("/run/gitterm/agent-files.json", "utf8"));
for (const file of files) {
  const target = file.path.startsWith("~/")
    ? path.join(os.homedir(), file.path.slice(2))
    : file.path;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from(file.contentBase64, "base64"));
}
NODE
        rm -f "$RUNTIME_DIR/agent-files.json"
    fi

    touch .initialized
fi

########################################
# RESUME (after restart)
########################################
REPO_NAME=$(cat .repo_name)
REPO_OWNER=$(cat .repo_owner 2>/dev/null || echo "")
REPO_DIR="/workspace/$REPO_NAME"
GITTERM_CONTEXT_DIR="/workspace/.gitterm"
AWS_RUNTIME_CONTEXT_FILE="$GITTERM_CONTEXT_DIR/aws-runtime-context.md"

if [ "$WORKSPACE_PROVIDER" = "aws" ] && [ -f /aws-agent-context.sh ]; then
    echo "Generating OpenCode AWS runtime context at $AWS_RUNTIME_CONTEXT_FILE..."
    GITTERM_CONTEXT_DIR="$GITTERM_CONTEXT_DIR" sh /aws-agent-context.sh || echo "⚠ Failed to generate AWS runtime context"

    if [ -f "$AWS_RUNTIME_CONTEXT_FILE" ]; then
        mkdir -p ~/.config/opencode
        if [ ! -f ~/.config/opencode/opencode.json ]; then
            printf '{}' > ~/.config/opencode/opencode.json
        fi

        AWS_RUNTIME_CONTEXT_FILE="$AWS_RUNTIME_CONTEXT_FILE" node <<'NODE'
const fs = require("fs");

const configPath = `${process.env.HOME}/.config/opencode/opencode.json`;
const contextFile = process.env.AWS_RUNTIME_CONTEXT_FILE;
const contextDir = contextFile.replace(/\/[^/]*$/, "/**");
let config = {};

try {
  config = JSON.parse(fs.readFileSync(configPath, "utf8") || "{}");
} catch {
  config = {};
}

const instructions = Array.isArray(config.instructions)
  ? config.instructions
  : typeof config.instructions === "string"
    ? [config.instructions]
    : [];

if (!instructions.includes(contextFile)) {
  instructions.push(contextFile);
}

config.instructions = instructions;
config.permission = config.permission && typeof config.permission === "object" ? config.permission : {};
config.permission.external_directory =
  config.permission.external_directory && typeof config.permission.external_directory === "object"
    ? config.permission.external_directory
    : {};
config.permission.external_directory[contextDir] = "allow";

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
NODE
    fi
fi

TOOLING_MANIFEST_JSON=""
TOOLING_MANIFEST_ENABLED=""

if [ -n "$WORKSPACE_TOOLING_MANIFEST_BASE64" ]; then
    if TOOLING_MANIFEST_JSON=$(printf '%s' "$WORKSPACE_TOOLING_MANIFEST_BASE64" | base64 -d 2>/dev/null); then
        if printf '%s' "$TOOLING_MANIFEST_JSON" | grep -q '"version":1'; then
            TOOLING_MANIFEST_ENABLED=1
            echo "Applying server tooling manifest..."
        else
            echo "⚠ Unsupported tooling manifest version - falling back to repo detection"
        fi
    else
        echo "⚠ Invalid tooling manifest payload - falling back to repo detection"
    fi
fi

########################################
# START AGENT / SHELL
########################################
cd "$REPO_NAME"

# All environment variables already set above
# Scripts and shells can source /workspace/.env for consistency

if ! command -v opencode >/dev/null 2>&1; then
    echo "❌ opencode not found in PATH: $PATH"
    exit 127
fi

echo "opencode version: $(opencode --version)"

exec "$@"
