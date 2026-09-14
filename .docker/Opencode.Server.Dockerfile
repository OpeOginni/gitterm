FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    bash \
    curl \
    unzip \
    ca-certificates \
    nodejs \
    npm \
    python3 \
    openssh-server \
    && rm -rf /var/lib/apt/lists/*

# Install OpenCode AI globally (IMPORTANT: keep global installs OUTSIDE /workspace)
# /workspace is a persisted volume in GitTerm, so anything installed under it can disappear on mount.
ARG OPENCODE_VERSION=2
ARG OPENCODE_INSTALL_CACHE_BUST=manual
RUN echo "opencode install cache bust: ${OPENCODE_INSTALL_CACHE_BUST}" \
    && npm cache clean --force \
    && echo "installing @opencode/cli@${OPENCODE_VERSION}" \
    && npm install -g "@opencode/cli@${OPENCODE_VERSION}" "@gitterm/cli@latest" --prefer-online --no-audit --fund=false \
    && echo "installed opencode: $(opencode --version)"

WORKDIR /workspace

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

COPY ./opencode/server.entrypoint.sh /entrypoint.sh
COPY ./workspace-setup-runner.sh /usr/local/bin/gitterm-workspace-setup
COPY ./git-credential-github.mjs /usr/local/bin/gitterm-git-credential
COPY ./runtime-bootstrap.mjs /usr/local/bin/gitterm-runtime-bootstrap
RUN chmod +x /entrypoint.sh /usr/local/bin/gitterm-workspace-setup /usr/local/bin/gitterm-git-credential /usr/local/bin/gitterm-runtime-bootstrap

ENV PORT=7681
EXPOSE 22
EXPOSE 7681

ENTRYPOINT ["/entrypoint.sh"]

# IPv6 support
CMD ["opencode", "serve", "--port", "7681", "--hostname", "[::]"]
