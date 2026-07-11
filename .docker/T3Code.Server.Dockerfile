# t3 requires node ^22.16 || ^23.11 || >=24.10 (EBADENGINE on node 20).
FROM node:22-bookworm-slim

# python3/make/g++ are required to compile t3's bundled node-pty (the npm
# package ships no linux-x64 prebuilds, so node-gyp rebuilds it at install).
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    bash \
    curl \
    unzip \
    ca-certificates \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install T3 Code plus the agent CLIs it drives (Claude Code, Codex, OpenCode).
# T3 has no server-side model APIs of its own: it spawns these CLIs locally, so
# they must exist in the image with their own credential stores provisioned by
# the entrypoint. (IMPORTANT: keep global installs OUTSIDE /workspace — it is a
# persisted volume in GitTerm, so anything under it can disappear on mount.)
ARG T3_VERSION=latest
ARG CLAUDE_CODE_VERSION=latest
ARG CODEX_VERSION=latest
ARG OPENCODE_VERSION=latest
ARG T3_INSTALL_CACHE_BUST=manual
RUN echo "t3 install cache bust: ${T3_INSTALL_CACHE_BUST}" \
    && npm cache clean --force \
    && npm install -g "t3@${T3_VERSION}" --prefer-online --no-audit --fund=false \
    && npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" --no-audit --fund=false \
    && npm install -g "@openai/codex@${CODEX_VERSION}" --no-audit --fund=false \
    && npm install -g "opencode-ai@${OPENCODE_VERSION}" --no-audit --fund=false \
    && echo "installed t3: $(t3 --version 2>/dev/null || echo unknown)"

# Set up working directory
WORKDIR /workspace

# Set environment variables for persistence
# These ensure all tools store data in /workspace by default. T3CODE_HOME keeps
# T3's projects/sessions/pairing grants on the persisted volume.
ENV HOME=/workspace \
    XDG_CONFIG_HOME=/workspace/.config \
    XDG_DATA_HOME=/workspace/.local/share \
    XDG_STATE_HOME=/workspace/.local/state \
    XDG_CACHE_HOME=/workspace/.cache \
    NPM_CONFIG_USERCONFIG=/workspace/.npmrc \
    NPM_CONFIG_CACHE=/workspace/.npm \
    T3CODE_HOME=/workspace/.t3code \
    OPENCODE_CONFIG_DIR=/workspace/.config/opencode \
    OPENCODE_DATA_DIR=/workspace/.local/share/opencode \
    OPENCODE_CACHE_DIR=/workspace/.cache/opencode \
    HISTFILE=/workspace/.bash_history \
    PATH=/workspace/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Copy and set up entrypoint script
COPY ./t3code/server.entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Expose the server port
ENV PORT=7681
EXPOSE 7681

# Define the entrypoint
ENTRYPOINT ["/entrypoint.sh"]

# Default command: headless T3 server. Pairing links are minted by the
# entrypoint and reported back to GitTerm.
CMD ["t3", "serve", "--host", "0.0.0.0", "--port", "7681", "--no-browser", "--auto-bootstrap-project-from-cwd"]

# docker build -f ./T3Code.Server.Dockerfile --platform linux/amd64 -t opeoginni/gitterm-t3code-server:latest .

# docker push opeoginni/gitterm-t3code-server:latest
