FROM oven/bun:1-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    bash \
    curl \
    ca-certificates \
    nodejs \
    npm \
    openssh-server \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /opt/bun
RUN BUN_INSTALL=/opt/bun bun add -g opencode-ai@latest

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

COPY ./opencode/server.entrypoint.sh /server-entrypoint.sh
COPY ./opencode/server-ssh.entrypoint.sh /entrypoint.sh
RUN chmod +x /server-entrypoint.sh /entrypoint.sh

ENV PORT=7681
EXPOSE 22
EXPOSE 7681

ENTRYPOINT ["/entrypoint.sh"]

CMD ["opencode", "serve", "--port", "7681", "--hostname", "[::]"]

# docker build -f ./Opencode.Server.SSH.Dockerfile --platform linux/amd64 -t opeoginni/gitterm-opencode-server-with-ssh:latest .
# docker push opeoginni/gitterm-opencode-server-with-ssh:latest
