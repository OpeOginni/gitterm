FROM oven/bun:1-slim
# FROM ghcr.io/anomalyco/opencode:latest

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    bash \
    curl \
    ca-certificates \
    nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install OpenCode AI globally (IMPORTANT: keep global installs OUTSIDE /workspace)
# /workspace is a persisted volume in GitTerm, so anything installed under it can disappear on mount.
RUN mkdir -p /opt/bun
RUN BUN_INSTALL=/opt/bun bun add -g opencode-ai@latest

# Set up working directory
WORKDIR /workspace

# Set environment variables for persistence
# These ensure all tools store data in /workspace by default
ENV HOME=/workspace \
    XDG_CONFIG_HOME=/workspace/.config \
    XDG_DATA_HOME=/workspace/.local/share \
    XDG_STATE_HOME=/workspace/.local/state \
    XDG_CACHE_HOME=/workspace/.cache \
    NPM_CONFIG_USERCONFIG=/workspace/.npmrc \
    NPM_CONFIG_CACHE=/workspace/.npm \
    OPENCODE_CONFIG_DIR=/workspace/.config/opencode \
    OPENCODE_DATA_DIR=/workspace/.local/share/opencode \
    OPENCODE_CACHE_DIR=/workspace/.cache/opencode \
    HISTFILE=/workspace/.bash_history \
    PATH=/workspace/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Copy and set up entrypoint script
COPY ./opencode/server.entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Expose the ttyd port
ENV PORT=7681
EXPOSE 7681

# Define the entrypoint
ENTRYPOINT ["/entrypoint.sh"]

# Default command

# IPv6 support
CMD ["opencode", "serve", "--port", "7681", "--hostname", "::"]

# docker build -f ./Opencode.Server.Dockerfile --platform linux/amd64 -t opeoginni/gitterm-opencode-server:latest .

# docker push opeoginni/gitterm-opencode-server:latest
