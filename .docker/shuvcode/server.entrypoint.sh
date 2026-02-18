#!/bin/sh
set -e

WORKSPACE="/workspace"
USER_GITHUB_USERNAME="${USER_GITHUB_USERNAME}"
GITHUB_APP_TOKEN="${GITHUB_APP_TOKEN}"
GITHUB_APP_TOKEN_EXPIRY="${GITHUB_APP_TOKEN_EXPIRY}"
USER_EMAIL="${USER_EMAIL:-${USER_GITHUB_USERNAME}@users.noreply.github.com}"

# Ensure workspace exists
mkdir -p "$WORKSPACE"
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

if [ ! -z "$GITHUB_APP_TOKEN" ]; then
    echo "Configuring git with GitHub App authentication..."
    
    # Configure git user (stored in /workspace/.gitconfig)
    if [ ! -z "$USER_GITHUB_USERNAME" ]; then
        git config --global user.name "$USER_GITHUB_USERNAME"
    fi
    
    if [ ! -z "$USER_EMAIL" ]; then
        git config --global user.email "$USER_EMAIL"
    fi
    
    # Disable interactive credential helper
    git config --global credential.helper ''
    
    # Create persistent credential helper script in /workspace
    # IMPORTANT: Use unquoted heredoc to expand $GITHUB_APP_TOKEN
    cat > /workspace/.git-credential-helper.sh <<CRED_HELPER
#!/bin/sh
if [ "\$1" = "get" ]; then
    echo "protocol=https"
    echo "host=github.com"
    echo "username=x-access-token"
    echo "password=${GITHUB_APP_TOKEN}"
fi
CRED_HELPER
    
    chmod +x /workspace/.git-credential-helper.sh
    git config --global credential.helper '/workspace/.git-credential-helper.sh'
    
    # Also store token in environment file for scripts to use
    echo "export GITHUB_APP_TOKEN='${GITHUB_APP_TOKEN}'" > /workspace/.github-token
    echo "export GITHUB_APP_TOKEN_EXPIRY='${GITHUB_APP_TOKEN_EXPIRY}'" >> /workspace/.github-token
    chmod 600 /workspace/.github-token
    
    echo "✓ Git configured with GitHub App token"
    echo "  Token expires at: $GITHUB_APP_TOKEN_EXPIRY"
else
    echo "⚠ No GitHub App token available - git operations will be limited"
fi

########################################
# FIRST-TIME SETUP
########################################
if [ ! -f ".initialized" ]; then
    echo "First-time workspace setup…"

    if [ ! -z "$REPO_URL" ]; then
        REPO_NAME=$(basename "$REPO_URL" .git)
        
        # Extract repo owner and name from URL
        # For URLs like: https://github.com/owner/repo.git
        REPO_OWNER=$(echo "$REPO_URL" | sed -E 's|https?://github\.com/([^/]+)/[^/]+.*|\1|')
        REPO_NAME_EXTRACTED=$(echo "$REPO_URL" | sed -E 's|https?://github\.com/[^/]+/([^/]+)(\.git)?|\1|')

        echo "Cloning repo: $REPO_URL into $REPO_NAME"
        
        # If GitHub App token is available, use authenticated URL
        if [ ! -z "$GITHUB_APP_TOKEN" ] && [ ! -z "$REPO_OWNER" ] && [ ! -z "$REPO_NAME_EXTRACTED" ]; then
            AUTH_URL="https://x-access-token:${GITHUB_APP_TOKEN}@github.com/${REPO_OWNER}/${REPO_NAME_EXTRACTED}.git"
            git clone "$AUTH_URL" "$REPO_NAME"
        else
            # Fallback to original URL (public repos only)
            git clone "$REPO_URL" "$REPO_NAME"
        fi
        
        echo "$REPO_OWNER" > .repo_owner
    else
        echo "No repo URL — using empty workspace."
        REPO_NAME="workspace"
        mkdir -p "$REPO_NAME"
        echo "" > .repo_owner
    fi

    echo "$REPO_NAME" > .repo_name

    # Save config
    if [ ! -z "$OPENCODE_CONFIG_BASE64" ]; then
        mkdir -p ~/.config/opencode
        echo "$OPENCODE_CONFIG_BASE64" | base64 -d > ~/.config/opencode/opencode.json
    fi

    touch .initialized
fi

########################################
# RESUME (after restart)
########################################
REPO_NAME=$(cat .repo_name)
REPO_OWNER=$(cat .repo_owner 2>/dev/null || echo "")

########################################
# GIT FORK SCRIPT
# Calls backend API to fork repository
# Only create if GitHub App token is available
########################################
if [ ! -z "$GITHUB_APP_TOKEN" ]; then
    cat > /workspace/git-fork.sh << 'EOF'
#!/bin/bash
REPO_DIR="/workspace/$(cat /workspace/.repo_name 2>/dev/null)"
cd "$REPO_DIR" 2>/dev/null || exit 1

# Check if we have WORKSPACE_AUTH_TOKEN and WORKSPACE_API_URL
if [ -z "$WORKSPACE_ID" ] || [ -z "$WORKSPACE_API_URL" ] || [ -z "$WORKSPACE_AUTH_TOKEN" ]; then
    echo "❌ Missing required environment variables for forking"
    exit 1
fi

# Get repo info from git config
REMOTE_URL=$(git config --get remote.origin.url 2>/dev/null)
if [ -z "$REMOTE_URL" ]; then
    echo "❌ No git remote configured"
    exit 1
fi

# Parse owner and repo from URL
# Handle both HTTPS and SSH formats
REPO_INFO=$(echo "$REMOTE_URL" | sed -E 's|.*[:/]([^/]+)/([^/]+)(\.git)?$|\1 \2|')
REPO_OWNER=$(echo "$REPO_INFO" | awk '{print $1}')
REPO_NAME=$(echo "$REPO_INFO" | awk '{print $2}')

echo "🔱 Forking $REPO_OWNER/$REPO_NAME..."

# Call workspace operations API to fork using JWT (in Authorization header)
RESPONSE=$(curl -s -X POST "$WORKSPACE_API_URL/workspaceOps.forkRepository" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $WORKSPACE_AUTH_TOKEN" \
  -d "{\"workspaceId\":\"$WORKSPACE_ID\",\"owner\":\"$REPO_OWNER\",\"repo\":\"$REPO_NAME\"}")

# Check if fork was successful
if echo "$RESPONSE" | grep -q '"success":true'; then
    # Extract authenticated URL from response
    AUTH_URL=$(echo "$RESPONSE" | grep -o '"authenticatedUrl":"[^"]*"' | cut -d'"' -f4)
    
    if [ ! -z "$AUTH_URL" ]; then
        # Update remote to point to fork
        git remote set-url origin "$AUTH_URL"
        echo "✅ Repository forked successfully!"
        echo "   Remote updated to your fork"
    else
        echo "✅ Repository forked but failed to extract URL"
        echo "   Response: $RESPONSE"
    fi
else
    echo "❌ Failed to fork repository"
    echo "   Response: $RESPONSE"
    exit 1
fi

/workspace/update-git-status.sh
EOF
    chmod +x /workspace/git-fork.sh
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

########################################
# START AGENT / SHELL
########################################
cd "$REPO_NAME"

# All environment variables already set above
# Scripts and shells can source /workspace/.env for consistency

# Run shuvcode upgrade and wait for completion before starting the agent
shuvcode upgrade --method bun || echo "Warning: shuvcode upgrade failed, continuing anyway"

exec "$@"