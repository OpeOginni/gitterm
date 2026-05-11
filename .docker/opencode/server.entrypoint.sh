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

########################################
# PERSISTENCE SETUP
# Environment variables are already set in Dockerfile
# Only create directories that may not exist yet
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
        
        # If GitHub App token is available, use authenticated URL
        if [ ! -z "$GITHUB_APP_TOKEN" ] && [ ! -z "$REPO_OWNER" ] && [ ! -z "$REPO_NAME" ]; then
            AUTH_URL="https://x-access-token:${GITHUB_APP_TOKEN}@github.com/${REPO_OWNER}/${REPO_NAME}.git"
            if [ -n "$REPO_BRANCH" ]; then
                git clone --branch "$REPO_BRANCH" --single-branch "$AUTH_URL" "$REPO_DIR_NAME"
            else
                git clone "$AUTH_URL" "$REPO_DIR_NAME"
            fi
        else
            # Fallback to original URL (public repos only)
            if [ -n "$REPO_BRANCH" ]; then
                git clone --branch "$REPO_BRANCH" --single-branch "$REPO_URL" "$REPO_DIR_NAME"
            else
                git clone "$REPO_URL" "$REPO_DIR_NAME"
            fi
        fi
        
        echo "$REPO_OWNER" > .repo_owner
    else
        echo "No repo URL - using empty workspace."
        REPO_DIR_NAME="workspace"
        mkdir -p "$REPO_DIR_NAME"
        echo "" > .repo_owner
    fi

    echo "$REPO_DIR_NAME" > .repo_name

    # Save config
    if [ ! -z "$OPENCODE_CONFIG_BASE64" ]; then
        mkdir -p ~/.config/opencode
        echo "$OPENCODE_CONFIG_BASE64" | base64 -d > ~/.config/opencode/opencode.json
    fi

    # Save credentials
    if [ ! -z "$OPENCODE_CREDENTIALS_BASE64" ]; then
        mkdir -p ~/.local/share/opencode
        echo "$OPENCODE_CREDENTIALS_BASE64" | base64 -d > ~/.local/share/opencode/auth.json
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

if [ -f /aws-agent-context.sh ]; then
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
# LANGUAGE TOOLING SETUP
########################################
if [ -d "$REPO_DIR" ]; then
    TOOLING_MARKER="/workspace/.tooling-initialized-$REPO_NAME"
    DOTNET_INSTALLED=""
    RUST_INSTALLED=""
    JAVA_INSTALLED=""

    has_cmd() {
        command -v "$1" >/dev/null 2>&1
    }

    ensure_pkg_manager() {
        if has_cmd apk; then
            PKG_MANAGER="apk"
        elif has_cmd apt-get; then
            PKG_MANAGER="apt"
        else
            PKG_MANAGER=""
        fi
    }

    install_packages() {
        ensure_pkg_manager
        if [ "$PKG_MANAGER" = "apk" ]; then
            apk add --no-cache "$@" || echo "⚠ Package install failed: $*"
        elif [ "$PKG_MANAGER" = "apt" ]; then
            if [ -z "$APT_UPDATED" ]; then
                APT_UPDATED=1
                apt-get update || echo "⚠ apt-get update failed"
            fi
            apt-get install -y --no-install-recommends "$@" || echo "⚠ Package install failed: $*"
        else
            echo "⚠ No supported package manager found for: $*"
        fi
    }

    repo_has() {
        find "$REPO_DIR" -maxdepth 4 -type f "$@" -print -quit 2>/dev/null | head -n 1
    }

    manifest_has_true() {
        printf '%s' "$TOOLING_MANIFEST_JSON" | grep -q '"'$1'":true'
    }

    ensure_bun() {
        if has_cmd bun; then
            return
        fi
        if ! has_cmd curl; then
            install_packages curl
        fi
        echo "Installing bun..."
        BUN_INSTALL=/workspace/.bun curl -fsSL https://bun.sh/install | bash || echo "⚠ Bun install failed"
        export PATH=/workspace/.bun/bin:$PATH
    }

    ensure_node() {
        if ! has_cmd node || ! has_cmd npm; then
            install_packages nodejs npm
        fi
    }

    ensure_pnpm() {
        if has_cmd pnpm; then
            return
        fi
        if has_cmd corepack; then
            corepack prepare pnpm@latest --activate || npm install -g pnpm || echo "⚠ pnpm install failed"
        else
            npm install -g pnpm || echo "⚠ pnpm install failed"
        fi
    }

    ensure_yarn() {
        if has_cmd yarn; then
            return
        fi
        if has_cmd corepack; then
            corepack prepare yarn@stable --activate || npm install -g yarn || echo "⚠ yarn install failed"
        else
            npm install -g yarn || echo "⚠ yarn install failed"
        fi
    }

    ensure_go() {
        if has_cmd go; then
            return
        fi
        ensure_pkg_manager
        if [ "$PKG_MANAGER" = "apk" ]; then
            install_packages go
        elif [ "$PKG_MANAGER" = "apt" ]; then
            install_packages golang-go
        fi
    }

    ensure_python() {
        if has_cmd python3; then
            return
        fi
        ensure_pkg_manager
        if [ "$PKG_MANAGER" = "apk" ]; then
            install_packages python3 py3-pip
        elif [ "$PKG_MANAGER" = "apt" ]; then
            install_packages python3 python3-pip
        fi
    }

    ensure_build_tools() {
        if has_cmd gcc && has_cmd g++; then
            return
        fi
        ensure_pkg_manager
        if [ "$PKG_MANAGER" = "apk" ]; then
            install_packages build-base
        elif [ "$PKG_MANAGER" = "apt" ]; then
            install_packages build-essential
        fi
    }

    ensure_dotnet() {
        if has_cmd dotnet; then
            return
        fi
        if ! has_cmd curl; then
            install_packages curl
        fi
        echo "Installing .NET SDK..."
        DOTNET_DIR="/workspace/.dotnet"
        mkdir -p "$DOTNET_DIR"
        curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh || return
        chmod +x /tmp/dotnet-install.sh
        /tmp/dotnet-install.sh --channel 8.0 --install-dir "$DOTNET_DIR" || echo "⚠ .NET install failed"
        export PATH="$DOTNET_DIR:$PATH"
        DOTNET_INSTALLED=1
    }

    ensure_rust() {
        if has_cmd rustc && has_cmd cargo; then
            return
        fi
        if ! has_cmd curl; then
            install_packages curl
        fi
        echo "Installing Rust toolchain..."
        export CARGO_HOME="/workspace/.cargo"
        export RUSTUP_HOME="/workspace/.rustup"
        curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal || echo "⚠ Rust install failed"
        export PATH="/workspace/.cargo/bin:$PATH"
        RUST_INSTALLED=1
    }

    ensure_java() {
        if has_cmd java; then
            return
        fi
        ensure_pkg_manager
        if [ "$PKG_MANAGER" = "apk" ]; then
            install_packages openjdk21-jdk
        elif [ "$PKG_MANAGER" = "apt" ]; then
            install_packages openjdk-21-jdk
        fi
        JAVA_INSTALLED=1
    }

    if [ -n "$TOOLING_MANIFEST_ENABLED" ]; then
        if manifest_has_true node; then
            ensure_node
        fi

        if manifest_has_true bun; then
            ensure_bun
        fi

        if manifest_has_true pnpm; then
            ensure_node
            ensure_pnpm
        fi

        if manifest_has_true yarn; then
            ensure_node
            ensure_yarn
        fi

        if manifest_has_true go; then
            ensure_go
        fi

        if manifest_has_true python; then
            ensure_python
        fi

        if manifest_has_true dotnet; then
            ensure_dotnet
        fi

        if manifest_has_true buildTools; then
            ensure_build_tools
        fi

        if manifest_has_true rust; then
            ensure_rust
        fi

        if manifest_has_true java; then
            ensure_java
        fi

        touch "$TOOLING_MARKER"
    elif [ ! -f "$TOOLING_MARKER" ]; then
        echo "Checking repository for language tooling needs..."

        if [ -n "$(repo_has -name package.json -o -name package-lock.json -o -name npm-shrinkwrap.json -o -name bun.lockb -o -name bun.lock -o -name pnpm-lock.yaml -o -name yarn.lock)" ]; then
            ensure_node
        fi

        if [ -n "$(repo_has -name bun.lockb -o -name bun.lock)" ]; then
            ensure_bun
        fi

        if [ -n "$(repo_has -name pnpm-lock.yaml)" ]; then
            ensure_node
            ensure_pnpm
        fi

        if [ -n "$(repo_has -name yarn.lock)" ]; then
            ensure_node
            ensure_yarn
        fi

        if [ -n "$(repo_has -name go.mod -o -name go.work)" ]; then
            ensure_go
        fi

        if [ -n "$(repo_has -name pyproject.toml -o -name requirements.txt -o -name Pipfile -o -name setup.py -o -name setup.cfg)" ]; then
            ensure_python
        fi

        if [ -n "$(repo_has -name '*.csproj' -o -name '*.sln' -o -name '*.cs')" ]; then
            ensure_dotnet
        fi

        if [ -n "$(repo_has -name '*.c' -o -name '*.h' -o -name '*.cpp' -o -name '*.hpp' -o -name '*.cc' -o -name '*.cxx' -o -name CMakeLists.txt -o -name Makefile)" ]; then
            ensure_build_tools
        fi

        if [ -n "$(repo_has -name Cargo.toml -o -name Cargo.lock -o -name rust-toolchain -o -name rust-toolchain.toml)" ]; then
            ensure_rust
        fi

        if [ -n "$(repo_has -name pom.xml -o -name build.gradle -o -name build.gradle.kts -o -name settings.gradle -o -name settings.gradle.kts -o -name gradlew -o -name mvnw -o -name '*.java')" ]; then
            ensure_java
        fi

        touch "$TOOLING_MARKER"
    fi
fi

########################################
# ENVIRONMENT FILE FOR PERSISTENCE
# Sourced by bash sessions and scripts for runtime additions
# Note: Base variables (HOME, XDG_*, GIT_CONFIG_GLOBAL, etc.) are set in Dockerfile
########################################
cat > /workspace/.env << 'ENV_FILE'
# Shell history
export HISTFILE=/workspace/.bash_history
export HISTSIZE=10000
export HISTFILESIZE=10000
ENV_FILE

chmod 644 /workspace/.env

if [ -n "$DOTNET_INSTALLED" ] && [ -f /workspace/.env ]; then
    if ! grep -q "/workspace/.dotnet" /workspace/.env; then
        echo 'export PATH=/workspace/.dotnet:$PATH' >> /workspace/.env
    fi
fi

if [ -n "$RUST_INSTALLED" ] && [ -f /workspace/.env ]; then
    if ! grep -q "/workspace/.cargo/bin" /workspace/.env; then
        echo 'export PATH=/workspace/.cargo/bin:$PATH' >> /workspace/.env
    fi
fi

########################################
# START AGENT / SHELL
########################################
cd "$REPO_NAME"

# All environment variables already set above
# Scripts and shells can source /workspace/.env for consistency

# Opencode is updated via image rebuilds, not runtime upgrades
if ! command -v opencode >/dev/null 2>&1; then
    echo "❌ opencode not found in PATH: $PATH"
    exit 127
fi

exec "$@"
