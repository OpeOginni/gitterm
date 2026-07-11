FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    bash \
    curl \
    zip \
    unzip \
    ca-certificates \
    nodejs \
    npm \
    openssh-server \
    && rm -rf /var/lib/apt/lists/*

# Install AWS CLI
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf awscliv2.zip aws

# Install OpenCode AI globally (IMPORTANT: keep global installs OUTSIDE /workspace)
ARG OPENCODE_VERSION=latest
ARG OPENCODE_INSTALL_CACHE_BUST=manual
RUN echo "opencode install cache bust: ${OPENCODE_INSTALL_CACHE_BUST}" \
    && npm cache clean --force \
    && echo "npm latest opencode-ai: $(npm view opencode-ai@${OPENCODE_VERSION} version)" \
    && npm install -g "opencode-ai@${OPENCODE_VERSION}" --prefer-online --no-audit --fund=false \
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
COPY ./opencode/aws-agent-context.sh /aws-agent-context.sh
RUN chmod +x /entrypoint.sh /aws-agent-context.sh

ENV PORT=7681
EXPOSE 22
EXPOSE 7681

ENTRYPOINT ["/entrypoint.sh"]

CMD ["opencode", "serve", "--port", "7681", "--hostname", "[::]"]
