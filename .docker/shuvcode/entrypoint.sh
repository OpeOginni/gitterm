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
# GIT STATUS UPDATE SCRIPT
# Creates/updates .git-status.json for UI
########################################
cat > /workspace/update-git-status.sh << 'EOF'
#!/bin/bash
REPO_DIR="/workspace/$(cat /workspace/.repo_name 2>/dev/null)"
OUTPUT_FILE="/workspace/.git-status.json"

cd "$REPO_DIR" 2>/dev/null || {
    echo '{"isRepo":false}' > "$OUTPUT_FILE"
    exit 0
}

# Check if git repo
if [ ! -d ".git" ]; then
    echo '{"isRepo":false}' > "$OUTPUT_FILE"
    exit 0
fi

# Get basic info
BRANCH=$(git branch --show-current 2>/dev/null || echo "main")
REMOTE_URL=$(git config --get remote.origin.url 2>/dev/null || echo "")

# Extract repo owner from URL (handle both HTTPS and SSH formats)
REPO_OWNER=""
if [ -n "$REMOTE_URL" ]; then
    # For HTTPS: https://github.com/username/repo.git -> username
    # For SSH: git@github.com:username/repo.git -> username
    REPO_OWNER=$(echo "$REMOTE_URL" | sed -E 's|.*[:/]([^/]+)/[^/]+(.git)?$|\1|')
fi

USER_GITHUB="${USER_GITHUB_USERNAME}"

# Check if user is NOT the repo owner (offer fork option)
CAN_FORK=false
if [ -n "$REPO_OWNER" ] && [ -n "$USER_GITHUB" ] && [ "$REPO_OWNER" != "$USER_GITHUB" ]; then
    CAN_FORK=true
fi

# Count changes
UNCOMMITTED_FILES=$(git status --porcelain 2>/dev/null | wc -l)
UNPUSHED_COMMITS=0
UPSTREAM=$(git rev-parse --abbrev-ref @{upstream} 2>/dev/null)
if [ -n "$UPSTREAM" ]; then
    UNPUSHED_COMMITS=$(git rev-list --count @{upstream}..HEAD 2>/dev/null || echo "0")
fi

# Output JSON for UI
cat > "$OUTPUT_FILE" << JSONEOF
{
  "isRepo": true,
  "branch": "$BRANCH",
  "uncommittedFiles": $UNCOMMITTED_FILES,
  "unpushedCommits": $UNPUSHED_COMMITS,
  "canFork": $CAN_FORK,
  "repoOwner": "$REPO_OWNER",
  "hasChanges": $([ $UNCOMMITTED_FILES -gt 0 ] && echo true || echo false),
  "canPush": $([ $UNPUSHED_COMMITS -gt 0 ] && echo true || echo false)
}
JSONEOF
EOF

chmod +x /workspace/update-git-status.sh

########################################
# GIT ACTION SCRIPTS
# Only create if GitHub App token is available
########################################
if [ ! -z "$GITHUB_APP_TOKEN" ]; then
    cat > /workspace/git-commit.sh << 'EOF'
#!/bin/bash
# Disable exit on error so we can capture detailed error info
set +e

# Source environment file for runtime additions
if [ -f /workspace/.env ]; then
    source /workspace/.env
fi

# Log file for debugging
LOG_FILE="/workspace/.git-commit.log"
exec 2>&1 | tee -a "$LOG_FILE"

echo "============================================"
echo "GIT COMMIT - $(date)"
echo "============================================"

# Load GitHub token from persistent storage
if [ -f /workspace/.github-token ]; then
    source /workspace/.github-token
fi

REPO_DIR="/workspace/$(cat /workspace/.repo_name 2>/dev/null)"

# Detailed debug logging
echo "[git-commit] Script called with args: $@"
echo "[git-commit] Working directory: $REPO_DIR"
echo "[git-commit] Git user.name: $(git config user.name 2>/dev/null || echo 'NOT SET')"
echo "[git-commit] Git user.email: $(git config user.email 2>/dev/null || echo 'NOT SET')"
echo "[git-commit] Git credential.helper: $(git config credential.helper 2>/dev/null || echo 'NOT SET')"

# Check if repo directory exists
if [ ! -d "$REPO_DIR" ]; then
    echo "❌ ERROR: Repository directory does not exist: $REPO_DIR"
    echo "   Available directories in /workspace:"
    ls -la /workspace/ | grep "^d" | awk '{print "   - " $NF}'
    exit 1
fi

# Change to repo directory
cd "$REPO_DIR" 2>/dev/null || {
    echo "❌ ERROR: Failed to change to repo directory: $REPO_DIR"
    echo "   Permissions: $(ls -ld $REPO_DIR)"
    exit 1
}

echo "[git-commit] Successfully changed to: $(pwd)"

# Check if it's a git repository
if [ ! -d ".git" ]; then
    echo "❌ ERROR: Not a git repository"
    echo "   Current directory: $(pwd)"
    echo "   Contents:"
    ls -la | head -20
    exit 1
fi

# Check if git is configured
GIT_USER=$(git config user.name 2>/dev/null)
GIT_EMAIL=$(git config user.email 2>/dev/null)

if [ -z "$GIT_USER" ] || [ -z "$GIT_EMAIL" ]; then
    echo "❌ ERROR: Git user not configured"
    echo "   user.name: ${GIT_USER:-NOT SET}"
    echo "   user.email: ${GIT_EMAIL:-NOT SET}"
    echo "   Git config contents:"
    git config --list | grep -E "(user|credential)" || echo "   (no config found)"
    exit 1
fi

echo "[git-commit] Git is properly configured"

# Get commit message
MESSAGE="${1:-Quick save from workspace}"
echo "[git-commit] Commit message: $MESSAGE"

# Check for changes
echo "[git-commit] Checking for changes..."
git status --short

# Add all changes
echo "[git-commit] Adding all changes..."
git add -A
ADD_STATUS=$?

if [ $ADD_STATUS -ne 0 ]; then
    echo "❌ ERROR: git add failed with status $ADD_STATUS"
    exit 1
fi

echo "[git-commit] Files staged:"
git diff --cached --name-only

# Attempt commit
echo "[git-commit] Attempting to commit..."
COMMIT_OUTPUT=$(git commit -m "$MESSAGE" 2>&1)
COMMIT_STATUS=$?

echo "$COMMIT_OUTPUT"

if [ $COMMIT_STATUS -eq 0 ]; then
    echo "✅ Changes committed successfully: $MESSAGE"
    /workspace/update-git-status.sh 2>/dev/null
    exit 0
else
    # Check if it's because there's nothing to commit
    if echo "$COMMIT_OUTPUT" | grep -q "nothing to commit\|no changes added"; then
        echo "ℹ️  Nothing to commit - working tree clean"
        /workspace/update-git-status.sh 2>/dev/null
        exit 0
    else
        echo "❌ ERROR: Commit failed with status $COMMIT_STATUS"
        echo "   Output: $COMMIT_OUTPUT"
        exit 1
    fi
fi
EOF

cat > /workspace/git-push.sh << 'EOF'
#!/bin/bash
set -e

# Load GitHub token from persistent storage
if [ -f /workspace/.github-token ]; then
    source /workspace/.github-token
fi

REPO_DIR="/workspace/$(cat /workspace/.repo_name 2>/dev/null)"

# Debug logging
echo "[git-push] Working directory: $REPO_DIR"
echo "[git-push] Git credential helper: $(git config credential.helper 2>/dev/null || echo 'NOT SET')"
echo "[git-push] Token available: $([ -n "$GITHUB_APP_TOKEN" ] && echo 'YES' || echo 'NO')"

cd "$REPO_DIR" 2>/dev/null || {
    echo "❌ Failed to change to repo directory: $REPO_DIR"
    exit 1
}

# Check if GitHub App token is available
if [ -z "$GITHUB_APP_TOKEN" ]; then
    echo "❌ GitHub App not connected - cannot push"
    echo "Please connect your GitHub account in the dashboard"
    exit 1
fi

# Test credential helper
echo "[git-push] Testing credential helper..."
git config --list | grep credential

if git push origin HEAD; then
    echo "✅ Changes pushed successfully"
    /workspace/update-git-status.sh
else
    echo "❌ Push failed"
    echo "   Check if GitHub App has write permissions"
    exit 1
fi
EOF

cat > /workspace/git-sync.sh << 'EOF'
#!/bin/bash
set -e

# Load GitHub token from persistent storage
if [ -f /workspace/.github-token ]; then
    source /workspace/.github-token
fi

# Commit + Push in one command
REPO_DIR="/workspace/$(cat /workspace/.repo_name 2>/dev/null)"
cd "$REPO_DIR" 2>/dev/null || exit 1

MESSAGE="${1:-Quick save from workspace}"

# Check if GitHub App token is available
if [ -z "$GITHUB_APP_TOKEN" ]; then
    echo "❌ GitHub App not connected - cannot push"
    echo "Please connect your GitHub account in the dashboard"
    exit 1
fi

git add -A
if git commit -m "$MESSAGE"; then
    echo "✅ Committed: $MESSAGE"
    if git push origin HEAD; then
        echo "✅ Pushed to remote"
    else
        echo "❌ Push failed"
    fi
else
    echo "ℹ️ Nothing to commit"
fi

/workspace/update-git-status.sh
EOF

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

    chmod +x /workspace/git-commit.sh /workspace/git-push.sh /workspace/git-sync.sh /workspace/git-fork.sh
fi

# Initialize git status file
/workspace/update-git-status.sh

########################################
# BACKGROUND GIT STATUS UPDATER
# Updates .git-status.json every 3 seconds
########################################
cat > /usr/local/bin/git-status-updater.sh << 'UPDATER'
#!/bin/bash
while true; do
    /workspace/update-git-status.sh 2>/dev/null
    sleep 3
done
UPDATER

chmod +x /usr/local/bin/git-status-updater.sh

# Start background updater with auto-restart
(
    while true; do
        /usr/local/bin/git-status-updater.sh
        echo "Git status updater crashed, restarting..."
        sleep 5
    done
) &

########################################
# BASHRC ADDITIONS
# Add helpful git shortcuts and source environment
########################################
cat >> /workspace/.bashrc << 'BASHRC'

# Source persistent environment variables
if [ -f /workspace/.env ]; then
    source /workspace/.env
fi

# Git shortcuts
alias gs='git status'
alias gc='git commit -m'
alias gp='git push'
alias gsync='/workspace/git-sync.sh'

# Auto-refresh git status after commands
git() {
    command git "$@"
    local ret=$?
    /workspace/update-git-status.sh 2>/dev/null &
    return $ret
}

# Helpful workspace info on login
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Workspace ready!"
echo "📁 HOME: $HOME (persistent volume)"
echo "📝 Git config: $(git config user.name 2>/dev/null || echo 'Not configured')"
if [ -f /workspace/.repo_name ]; then
    echo "📦 Repository: $(cat /workspace/.repo_name)"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

BASHRC

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