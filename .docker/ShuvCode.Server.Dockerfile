FROM oven/bun:1-slim

# Install git and other essential tools
RUN apt-get update && apt-get install -y \
    git \
    && rm -rf /var/lib/apt/lists/*
    
# Install ShuvCode globally (IMPORTANT: keep global installs OUTSIDE /workspace)
# /workspace is a persisted volume in GitTerm, so anything installed under it can disappear on mount.
RUN mkdir -p /opt/bun
RUN BUN_INSTALL=/opt/bun bun add -g shuvcode@latest

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
    # Keep Bun global install location outside the persisted /workspace volume
    BUN_INSTALL=/opt/bun \
    PATH="/opt/bun/install/global/node_modules/.bin:${PATH}" \
    OPENCODE_CONFIG_DIR=/workspace/.config/opencode \
    OPENCODE_DATA_DIR=/workspace/.local/share/opencode \
    OPENCODE_CACHE_DIR=/workspace/.cache/opencode \
    HISTFILE=/workspace/.bash_history

# Copy and set up entrypoint script
COPY ./shuvcode/server.entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Expose the ttyd port
ENV PORT=7681
EXPOSE 7681

# Define the entrypoint
ENTRYPOINT ["/entrypoint.sh"]

# Default command

# IPv6 support
CMD ["shuvcode", "serve", "--port", "7681", "--hostname", "::"]

# docker build -f ./ShuvCode.Server.Dockerfile --platform linux/amd64 -t opeoginni/gitterm-shuvcode-server:latest .

# docker push opeoginni/gitterm-shuvcode-server:latest